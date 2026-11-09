import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del control semanal de amenidades (Etapa 4, pasos 5-8). Sin acceso a base de datos.
 */

/** Umbral de diferencia (%) a partir del cual se revisa y se avisa al Gerente de Operaciones. */
export const DIFF_THRESHOLD_PCT = 10;

const round = (value: number, decimals: number): number => {
  const k = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * k) / k;
};

// ── Fechas (claves AAAA-MM-DD, aritmética en UTC puro) ───────────────────────

const parseKey = (key: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new HttpError(400, "INVALID_FILTER", { field: "date" });
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "INVALID_FILTER", { field: "date" });
  return date;
};

const toKey = (date: Date): string => date.toISOString().slice(0, 10);

export const addDaysKey = (key: string, days: number): string => {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d);
};

/** Lista de claves de día de `from` a `to` (ambos inclusive). */
export const dayKeys = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let key = from; key <= to && out.length < 400; key = addDaysKey(key, 1)) out.push(key);
  return out;
};

/** Inicio de la semana (clave) que contiene `key`; `weekStart` = índice JS (0 domingo ... 6 sábado). */
export const weekStartKey = (key: string, weekStart: number): string => {
  const delta = (parseKey(key).getUTCDay() - weekStart + 7) % 7;
  return addDaysKey(key, -delta);
};

// ── Ocupación (D13) ──────────────────────────────────────────────────────────

export interface StatusChangeLike {
  roomId: string;
  to: string;
  createdAt: Date;
}

/**
 * Noches ocupadas: por cada instante de corte (23:59 de cada día) cuenta las habitaciones cuyo último
 * cambio de estado hasta ese instante dejó OCCUPIED. `changes` debe incluir el último cambio previo al rango.
 */
export const countOccupiedNights = (changes: StatusChangeLike[], cutoffs: Date[]): number => {
  const byRoom = new Map<string, StatusChangeLike[]>();
  for (const change of changes) {
    const list = byRoom.get(change.roomId) ?? [];
    list.push(change);
    byRoom.set(change.roomId, list);
  }
  let nights = 0;
  for (const list of byRoom.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const cutoff of cutoffs) {
      let state: string | null = null;
      for (const change of list) {
        if (change.createdAt.getTime() > cutoff.getTime()) break;
        state = change.to;
      }
      if (state === "OCCUPIED") nights++;
    }
  }
  return nights;
};

// ── Estándar por habitación ocupada ──────────────────────────────────────────

export interface RoomKit {
  lines: Array<{ productId: string; quantity: number }>;
}

/** Promedio ponderado por # de habitaciones: la habitación cuyo kit no lleva el producto cuenta con 0. */
export const weightedStandard = (rooms: RoomKit[]): Map<string, number> => {
  const totals = new Map<string, number>();
  if (rooms.length === 0) return totals;
  for (const room of rooms) for (const line of room.lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  return new Map([...totals.entries()].map(([productId, total]) => [productId, round(total / rooms.length, 3)]));
};

// ── Libro mayor: saldo al inicio / fin de semana ─────────────────────────────

export interface LedgerMovement {
  type: string;
  status: string;
  date: Date;
  receivedAt: Date | null;
  fromWarehouseId: string | null;
  warehouseId: string | null;
  lines: Array<{ productId: string; quantity: number; receivedQuantity: number | null }>;
}

const SOURCE_DELTA_TYPES = new Set([
  "TRANSFER", "LINEN_EXCHANGE", "FIRST_WASH", "SUPPLIER_RETURN", "LOAN_OUT", "LOAN_RETURN",
  "ROOM_EXTRA", "ROOM_CONSUMPTION", "ADJUST_OUT", "WRITE_OFF",
]);
const TARGET_DELTA_TYPES = new Set([
  "INITIAL_LOAD", "INBOUND", "ADJUST_IN", "TRANSFER", "LINEN_EXCHANGE", "FIRST_WASH", "SUPPLIER_RETURN", "LOAN_OUT", "LOAN_RETURN",
]);

export interface LedgerEvent {
  at: Date;
  productId: string;
  /** Positivo = entra al almacén; negativo = sale. */
  quantity: number;
  type: string;
}

/**
 * Eventos de saldo del almacén: la salida cuenta en `date` (al enviar); la entrada, en la recepción
 * (`receivedAt`, con lo contado) o en `date` si no pasó por tránsito. Cancelados y en tránsito sin recibir no entran.
 */
export const warehouseEvents = (movements: LedgerMovement[], warehouseId: string): LedgerEvent[] => {
  const events: LedgerEvent[] = [];
  for (const m of movements) {
    if (m.status === "CANCELLED" || m.status === "PENDING_APPROVAL") continue;
    if (m.fromWarehouseId === warehouseId && SOURCE_DELTA_TYPES.has(m.type)) {
      for (const l of m.lines) events.push({ at: m.date, productId: l.productId, quantity: -l.quantity, type: m.type });
    }
    if (m.warehouseId === warehouseId && TARGET_DELTA_TYPES.has(m.type)) {
      if (m.status === "IN_TRANSIT") continue;
      const at = m.receivedAt ?? m.date;
      for (const l of m.lines) {
        const qty = m.receivedAt ? (l.receivedQuantity ?? l.quantity) : l.quantity;
        events.push({ at, productId: l.productId, quantity: qty, type: m.type });
      }
    }
  }
  return events;
};

/** Suma por producto de los eventos con `at >= from` (y `< to` si se indica). */
export const netInWindow = (events: LedgerEvent[], from: Date, to?: Date, only?: "IN" | "OUT"): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.at.getTime() < from.getTime()) continue;
    if (to && e.at.getTime() >= to.getTime()) continue;
    if (only === "IN" && e.quantity <= 0) continue;
    if (only === "OUT" && e.quantity >= 0) continue;
    out.set(e.productId, (out.get(e.productId) ?? 0) + e.quantity);
  }
  return out;
};

/** Saldo en el instante `at` = saldo actual − movimiento neto posterior a `at`. */
export const balanceAt = (current: Map<string, number>, events: LedgerEvent[], at: Date): Map<string, number> => {
  const after = netInWindow(events, at);
  const out = new Map<string, number>();
  for (const productId of new Set([...current.keys(), ...after.keys()])) {
    out.set(productId, round((current.get(productId) ?? 0) - (after.get(productId) ?? 0), 3));
  }
  return out;
};

// ── Fórmulas del renglón ─────────────────────────────────────────────────────

export interface AmenityLineInput {
  standardPerRoom: number;
  initialStock: number;
  supplied: number;
  extras: number;
  finalStock: number;
}

export interface AmenityLineResult {
  realConsumption: number;
  expectedConsumption: number;
  /** null cuando el esperado es 0. */
  diffPct: number | null;
}

/** Real = inicial + surtido − final; esperado = ocupadas × estándar + extras; diferencia % = (real − esperado) / esperado. */
export const computeAmenityLine = (occupiedNights: number, line: AmenityLineInput): AmenityLineResult => {
  const realConsumption = round(line.initialStock + line.supplied - line.finalStock, 3);
  const expectedConsumption = round(occupiedNights * line.standardPerRoom + line.extras, 3);
  const diffPct = expectedConsumption > 0 ? round(((realConsumption - expectedConsumption) / expectedConsumption) * 100, 2) : null;
  return { realConsumption, expectedConsumption, diffPct };
};

/** |diferencia| > 10%; sin esperado, cualquier consumo real distinto de 0 también se señala. */
export const exceedsThreshold = (result: AmenityLineResult): boolean =>
  result.diffPct === null ? result.realConsumption !== 0 : Math.abs(result.diffPct) > DIFF_THRESHOLD_PCT;

// ── Mínimo de la bodega ──────────────────────────────────────────────────────

/** Bajo mínimo: hay mínimo definido (> 0) y el saldo es menor o igual. */
export const atOrBelowMin = (stock: number, min: number): boolean => min > 0 && stock <= min;

// ── Roles ────────────────────────────────────────────────────────────────────

export const REVIEW_ROLES = ["HOTEL_GENERAL_SUPERVISOR", "HOTEL_OPS_MANAGER", "ADMIN"];
export const ACKNOWLEDGE_ROLES = ["HOTEL_OPS_MANAGER", "ADMIN"];

export const hasAnyRole = (roles: string[] | undefined, allowed: string[]): boolean => (roles ?? []).some((r) => allowed.includes(r));
