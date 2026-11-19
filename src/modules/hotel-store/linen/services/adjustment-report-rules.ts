/** Reglas puras del reporte de ajustes al inventario (sin acceso a base de datos). */

export type AdjustmentType = "ADJUST_IN" | "ADJUST_OUT" | "WRITE_OFF";
export type AdjustmentStatus = "PENDING_APPROVAL" | "ACTIVE" | "CANCELLED";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Entrada suma al inventario; ajuste de salida y baja lo restan. */
export const adjustmentDirection = (type: string): "IN" | "OUT" => (type === "ADJUST_IN" ? "IN" : "OUT");

/** Almacén afectado: la baja retenida en cuarentena usa el origen real. */
export const adjustmentWarehouseId = (m: {
  type: string;
  warehouseId: string | null;
  fromWarehouseId: string | null;
  originWarehouseId: string | null;
}): string | null => (m.type === "ADJUST_IN" ? m.warehouseId : m.originWarehouseId ?? m.fromWarehouseId ?? m.warehouseId);

/** Costo de la línea: el propio o, sin él, el último costo del producto; null si no hay ninguno. */
export const adjustmentUnitCost = (own: number | null, lastCost: number | null): number | null => own ?? lastCost;

export interface AdjustmentAggRow {
  status: AdjustmentStatus;
  quantity: number;
  totalCost: number;
  reasonKey: string | null;
  reasonName: string | null;
  warehouseKey: string | null;
  warehouseName: string | null;
}

export interface AdjustmentGroup {
  key: string | null;
  name: string | null;
  pieces: number;
  cost: number;
}

/** Los rechazados (CANCELLED) no afectan inventario: no suman a los totales. */
export const countsInTotals = (status: AdjustmentStatus): boolean => status !== "CANCELLED";

const group = (rows: AdjustmentAggRow[], keyOf: (r: AdjustmentAggRow) => [string | null, string | null]): AdjustmentGroup[] => {
  const map = new Map<string, AdjustmentGroup>();
  for (const r of rows) {
    if (!countsInTotals(r.status)) continue;
    const [key, name] = keyOf(r);
    const k = key ?? "";
    const g = map.get(k) ?? { key, name, pieces: 0, cost: 0 };
    g.pieces = round3(g.pieces + r.quantity);
    g.cost = round2(g.cost + r.totalCost);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || (a.name ?? "").localeCompare(b.name ?? ""));
};

/** Totales de piezas y costo por motivo y por almacén, más el gran total. */
export const aggregateAdjustments = (rows: AdjustmentAggRow[]) => {
  const counted = rows.filter((r) => countsInTotals(r.status));
  return {
    byReason: group(rows, (r) => [r.reasonKey, r.reasonName]),
    byWarehouse: group(rows, (r) => [r.warehouseKey, r.warehouseName]),
    total: {
      pieces: round3(counted.reduce((s, r) => s + r.quantity, 0)),
      cost: round2(counted.reduce((s, r) => s + r.totalCost, 0)),
    },
  };
};
