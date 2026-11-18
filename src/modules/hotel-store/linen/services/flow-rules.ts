/** Reglas puras del tablero de flujo de blancos (sin base de datos). */

export const FLOW_STAGES = ["AREAS", "DIRTY", "LAUNDRY", "CLEAN", "LENT", "QUARANTINE", "STORE"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

/** Etapa de una ubicación; `null` = fuera de las 7 etapas (apartado HOLD, equipos, administrativo). */
export const classifyLocation = (warehouseKind: string, locationCode: string): FlowStage | null => {
  switch (locationCode) {
    case "DIRTY":
      return "DIRTY";
    case "IN_PROCESS":
      return "LAUNDRY";
    case "CLEAN":
      return "CLEAN";
    case "QUARANTINE":
      return "QUARANTINE";
    case "LENT":
      return "LENT";
    case "CART":
      return "AREAS";
    case "GENERAL":
      if (warehouseKind === "ZONE" || warehouseKind === "POINT" || warehouseKind === "SPA") return "AREAS";
      if (warehouseKind === "CENTRAL" || warehouseKind === "NEW_LINEN") return "STORE";
      return null;
    default:
      return null;
  }
};

export interface FlowRow {
  productId: string;
  stages: Record<FlowStage, number>;
  /** De LENT, lo que está en habitaciones por adicionales abiertos (ya sumado en `LENT`). */
  inRooms: number;
  /** Fuera de las 7 etapas (HOLD, equipos). */
  other: number;
  inTransit: number;
  total: number;
}

export const emptyStages = (): Record<FlowStage, number> => ({ AREAS: 0, DIRTY: 0, LAUNDRY: 0, CLEAN: 0, LENT: 0, QUARANTINE: 0, STORE: 0 });

export interface FlowStockCell {
  productId: string;
  warehouseKind: string;
  locationCode: string;
  quantity: number;
}

/** Arma los renglones por producto: existencia por etapa, adicionales en habitaciones y tránsito. */
export const buildFlowRows = (
  productIds: string[],
  stock: FlowStockCell[],
  inRooms: Map<string, number>,
  inTransit: Map<string, number>
): FlowRow[] => {
  const rows = new Map<string, FlowRow>(
    productIds.map((id) => [id, { productId: id, stages: emptyStages(), inRooms: 0, other: 0, inTransit: 0, total: 0 }])
  );
  for (const cell of stock) {
    const row = rows.get(cell.productId);
    if (!row) continue;
    const stage = classifyLocation(cell.warehouseKind, cell.locationCode);
    if (stage) row.stages[stage] += cell.quantity;
    else row.other += cell.quantity;
  }
  for (const row of rows.values()) {
    row.inRooms = inRooms.get(row.productId) ?? 0;
    row.stages.LENT += row.inRooms;
    row.inTransit = inTransit.get(row.productId) ?? 0;
    row.total = FLOW_STAGES.reduce((s, st) => s + row.stages[st], 0) + row.other + row.inTransit;
  }
  return [...rows.values()];
};

/** Productos cuyo total del flujo (sin lo que está en habitaciones) no iguala al de /stock/summary. */
export const flowMismatches = (rows: FlowRow[], summaryTotals: Map<string, number>): string[] =>
  rows.filter((r) => Math.abs(r.total - r.inRooms - (summaryTotals.get(r.productId) ?? 0)) > 0.0005).map((r) => r.productId);
