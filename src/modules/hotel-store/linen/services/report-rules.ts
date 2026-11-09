import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras de los reportes de blancos (F7): inversión al par, merma por fuente, saldo corrido
 * del kardex y estado físico. Sin acceso a base de datos: el servicio las usa y las pruebas las cubren.
 */

export const IVA_STANDARD = 0.16;
export const IVA_BORDER = 0.08;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export interface InvestmentInput {
  total: number;
  par: number;
  lastCost: number | null;
}

/** Faltante a par = par − total (mínimo 0); sin par no hay faltante. */
export const parShortfall = (total: number, par: number): number => (par > 0 ? Math.max(0, round3(par - total)) : 0);

/** Inversión para llegar al par = faltante × último costo, antes de IVA y con IVA 16 % y 8 % (frontera). */
export const investmentToPar = (input: InvestmentInput) => {
  const shortfall = parShortfall(input.total, input.par);
  const cost = input.lastCost ?? 0;
  const subtotal = round2(shortfall * cost);
  return {
    shortfall,
    subtotal,
    iva16: round2(subtotal * IVA_STANDARD),
    total16: round2(subtotal * (1 + IVA_STANDARD)),
    iva8: round2(subtotal * IVA_BORDER),
    total8: round2(subtotal * (1 + IVA_BORDER)),
    hasCost: input.lastCost !== null,
  };
};

/** Suma de inversiones (cada renglón ya viene redondeado; el total se redondea una sola vez). */
export const sumInvestments = (rows: Array<{ subtotal: number }>) => {
  const subtotal = round2(rows.reduce((s, r) => s + r.subtotal, 0));
  return {
    subtotal,
    iva16: round2(subtotal * IVA_STANDARD),
    total16: round2(subtotal * (1 + IVA_STANDARD)),
    iva8: round2(subtotal * IVA_BORDER),
    total8: round2(subtotal * (1 + IVA_BORDER)),
  };
};

// ── Merma ───────────────────────────────────────────────────────────────────

export const SHRINKAGE_SOURCES = ["TRANSFER", "COUNT", "TOWEL", "WRITEOFF"] as const;
export type ShrinkageSource = (typeof SHRINKAGE_SOURCES)[number];

/** Faltante de un traspaso recibido con diferencia: enviado − recibido (si recibió de más no es merma). */
export const transferShortage = (sent: number, received: number | null): number => (received === null ? 0 : Math.max(0, round3(sent - received)));

/** Toallas no devueltas de un préstamo: prestadas − devueltas (mínimo 0). */
export const towelShortage = (lent: number, returned: number): number => Math.max(0, round3(lent - returned));

export interface ShrinkageRow {
  source: ShrinkageSource;
  productId: string;
  quantity: number;
  unitCost: number | null;
  /** Motivo de la baja (solo fuente WRITEOFF). */
  reasonCode?: string | null;
}

/** Agrupa la merma por fuente y por producto, en piezas y pesos. */
export const aggregateShrinkage = (rows: ShrinkageRow[]) => {
  const bySource = Object.fromEntries(SHRINKAGE_SOURCES.map((s) => [s, { pieces: 0, amount: 0 }])) as Record<ShrinkageSource, { pieces: number; amount: number }>;
  const byProduct = new Map<string, { productId: string; pieces: number; amount: number; sources: Record<ShrinkageSource, number> }>();
  const byReason: Record<string, { pieces: number; amount: number }> = {};
  for (const r of rows) {
    if (!(r.quantity > 0)) continue;
    const amount = round2(r.quantity * (r.unitCost ?? 0));
    bySource[r.source].pieces = round3(bySource[r.source].pieces + r.quantity);
    bySource[r.source].amount = round2(bySource[r.source].amount + amount);
    const p = byProduct.get(r.productId) ?? {
      productId: r.productId,
      pieces: 0,
      amount: 0,
      sources: { TRANSFER: 0, COUNT: 0, TOWEL: 0, WRITEOFF: 0 },
    };
    p.pieces = round3(p.pieces + r.quantity);
    p.amount = round2(p.amount + amount);
    p.sources[r.source] = round3(p.sources[r.source] + r.quantity);
    byProduct.set(r.productId, p);
    if (r.source === "WRITEOFF") {
      const key = r.reasonCode ?? "?";
      const e = byReason[key] ?? { pieces: 0, amount: 0 };
      e.pieces = round3(e.pieces + r.quantity);
      e.amount = round2(e.amount + amount);
      byReason[key] = e;
    }
  }
  const total = {
    pieces: round3(SHRINKAGE_SOURCES.reduce((s, k) => s + bySource[k].pieces, 0)),
    amount: round2(SHRINKAGE_SOURCES.reduce((s, k) => s + bySource[k].amount, 0)),
  };
  return { bySource, byProduct: [...byProduct.values()], byReason, total };
};

// ── Kardex ──────────────────────────────────────────────────────────────────

export interface KardexEntry {
  /** Cambio neto en la existencia consultada (+ entra, − sale). */
  delta: number;
}

/** Saldo corrido: cada renglón recibe `balance` = saldo inicial + suma acumulada de los deltas. */
export const runningBalance = <T extends KardexEntry>(entries: T[], opening = 0): Array<T & { balance: number }> => {
  let balance = opening;
  return entries.map((e) => {
    balance = round3(balance + e.delta);
    return { ...e, balance };
  });
};

/**
 * Delta de una línea de movimiento sobre un almacén (o el total del hotel si `warehouseId` es null).
 * Un traspaso en tránsito ya descontó el origen y todavía no suma al destino; al recibirse el destino
 * suma lo recibido. Entre almacenes del hotel el traspaso no cambia el total.
 */
export const lineDelta = (
  line: { quantity: number; receivedQuantity: number | null },
  movement: { status: string; fromWarehouseId: string | null; warehouseId: string | null },
  warehouseId: string | null
): number => {
  const inbound = movement.status === "IN_TRANSIT" ? 0 : line.receivedQuantity ?? line.quantity;
  if (warehouseId) {
    let d = 0;
    if (movement.fromWarehouseId === warehouseId) d -= line.quantity;
    if (movement.warehouseId === warehouseId) d += inbound;
    return round3(d);
  }
  if (movement.fromWarehouseId && movement.warehouseId) {
    // Entre almacenes del hotel solo cuenta la pérdida de un traspaso recibido con diferencia.
    return movement.status === "RECEIVED_WITH_DIFFERENCE" ? round3(inbound - line.quantity) : 0;
  }
  return movement.fromWarehouseId ? round3(-line.quantity) : round3(inbound);
};

// ── Estado físico ───────────────────────────────────────────────────────────

export const pctOf = (part: number, total: number): number | null => (total > 0 ? round2((part / total) * 100) : null);

// ── Periodo ─────────────────────────────────────────────────────────────────

/** `AAAA-MM-DD` -> [inicio, inicio del día siguiente al fin). Por defecto los últimos 30 días. */
export const periodRange = (from?: string | null, to?: string | null, now: Date = new Date()): { from: Date; to: Date } => {
  const parse = (value: string, field: string): Date => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) throw new HttpError(400, "INVALID_FILTER", { field });
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "INVALID_FILTER", { field });
    return d;
  };
  const end = to ? parse(to, "to") : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = from ? parse(from, "from") : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29);
  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  if (start >= endExclusive) throw new HttpError(400, "INVALID_FILTER", { field: "from" });
  return { from: start, to: endExclusive };
};

export const tone = (count: number): "neutral" | "warn" => (count > 0 ? "warn" : "neutral");

// ── Vida útil en lavadas (ajuste demo v2) ──────────────────────────────────

/** Meses del periodo (mínimo 0.25 para no disparar el ritmo en rangos muy cortos). */
export const periodMonths = (from: Date, to: Date): number =>
  Math.max(0.25, (to.getTime() - from.getTime()) / (30.4 * 24 * 60 * 60 * 1000));

/** Lavadas por pieza al mes: piezas lavadas en el periodo / existencia total / meses. */
export const washRate = (washed: number, totalPieces: number, months: number): number =>
  totalPieces > 0 && months > 0 ? round2(washed / totalPieces / months) : 0;

export interface LotLifeEstimate {
  ageMonths: number;
  /** Lavadas estimadas = antigüedad en meses x ritmo; null si el artículo no se lava. */
  estWashes: number | null;
  /** Fracción de la vida útil consumida (0..>1); null si el artículo no tiene vida útil. */
  pctLife: number | null;
}

/** Vida útil usada por un lote de compra a partir de su antigüedad y el ritmo del artículo. */
export const lotLifeEstimate = (
  receivedAt: Date,
  now: Date,
  rate: number,
  washLife: number | null
): LotLifeEstimate => {
  const ageMonths = Math.max(0, (now.getTime() - receivedAt.getTime()) / (30.4 * 24 * 60 * 60 * 1000));
  const estWashes = washLife !== null && rate > 0 ? ageMonths * rate : null;
  return {
    ageMonths: round2(ageMonths),
    estWashes: estWashes === null ? null : round2(estWashes),
    pctLife: estWashes !== null && washLife ? round2(estWashes / washLife) : null,
  };
};
