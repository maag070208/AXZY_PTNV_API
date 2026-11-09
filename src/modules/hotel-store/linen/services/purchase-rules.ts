import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras de compras del hotel (OC, recepción con apartado y reposición). Sin acceso a base de
 * datos: los servicios las usan y las pruebas unitarias las cubren.
 */

const EPSILON = 1e-9;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type PurchaseOrderStatus = "DRAFT" | "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";

/** Estados en los que la OC aún espera mercancía (cuentan como "en tránsito" para el sugerido). */
export const OPEN_ORDER_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "APPROVED", "PARTIALLY_RECEIVED"];
/** Estados en los que se puede recibir. */
export const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ["APPROVED", "PARTIALLY_RECEIVED"];

// ── Días hábiles ───────────────────────────────────────────────────────────

/** Suma `days` días hábiles (lunes a viernes) a una fecha; la hora se conserva. */
export const addBusinessDays = (from: Date, days: number): Date => {
  const result = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return result;
};

/** Plazo de Compras para resolver un apartado: 5 días hábiles. */
export const HOLD_BUSINESS_DAYS = 5;
export const holdDueDate = (from: Date): Date => addBusinessDays(from, HOLD_BUSINESS_DAYS);

// ── Totales con IVA ────────────────────────────────────────────────────────

export interface AmountLine {
  quantity: number;
  unitCost: number;
  /** Fracción: 0.16 = 16 %. */
  taxRate: number;
}

export const lineAmounts = (line: AmountLine) => {
  const subtotal = round2(line.quantity * line.unitCost);
  const tax = round2(subtotal * line.taxRate);
  return { subtotal, tax, total: round2(subtotal + tax) };
};

/** Totales de la OC y desglose de IVA por tasa. Costos antes de IVA. */
export const orderTotals = (lines: AmountLine[]) => {
  let subtotal = 0;
  let tax = 0;
  const byRate = new Map<number, { rate: number; base: number; tax: number }>();
  for (const line of lines) {
    const a = lineAmounts(line);
    subtotal += a.subtotal;
    tax += a.tax;
    const row = byRate.get(line.taxRate) ?? { rate: line.taxRate, base: 0, tax: 0 };
    row.base = round2(row.base + a.subtotal);
    row.tax = round2(row.tax + a.tax);
    byRate.set(line.taxRate, row);
  }
  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    total: round2(subtotal + tax),
    taxes: [...byRate.values()].sort((a, b) => a.rate - b.rate),
  };
};

// ── Máquina de estados de la OC ────────────────────────────────────────────

/** Estado de la OC según lo aceptado en inventario: todo cubierto -> RECEIVED; algo -> PARTIALLY_RECEIVED. */
export const statusAfterReceipt = (lines: Array<{ quantity: number; receivedQuantity: number }>): "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" => {
  if (lines.length === 0) return "APPROVED";
  if (lines.every((l) => l.receivedQuantity + EPSILON >= l.quantity)) return "RECEIVED";
  return lines.some((l) => l.receivedQuantity > EPSILON) ? "PARTIALLY_RECEIVED" : "APPROVED";
};

/** Aprobar: solo borrador, con proveedor, y no por quien la creó. */
export const assertCanApprove = (order: { status: string; supplierId: string | null; createdById: string }, actorId: string): void => {
  if (order.status !== "DRAFT") throw new HttpError(409, "HOTEL_PO_INVALID_STATE", { status: order.status });
  if (!order.supplierId) throw new HttpError(409, "HOTEL_SUPPLIER_REQUIRED");
  if (order.createdById === actorId) throw new HttpError(409, "HOTEL_PO_SELF_APPROVAL");
};

/** Cancelar: borrador, o aprobada sin nada recibido (con recepciones se cierra con faltante). */
export const assertCanCancel = (order: { status: string }, receiptCount: number): void => {
  if (order.status === "DRAFT") return;
  if (order.status === "APPROVED") {
    if (receiptCount > 0) throw new HttpError(409, "HOTEL_PO_HAS_RECEIPTS");
    return;
  }
  if (order.status === "PARTIALLY_RECEIVED") throw new HttpError(409, "HOTEL_PO_HAS_RECEIPTS");
  throw new HttpError(409, "HOTEL_PO_INVALID_STATE", { status: order.status });
};

/** Cerrar con faltante: aprobada o parcial, con motivo obligatorio. */
export const assertCanClose = (order: { status: string }, notes: string | null | undefined): void => {
  if (!RECEIVABLE_STATUSES.includes(order.status as PurchaseOrderStatus)) throw new HttpError(409, "HOTEL_PO_INVALID_STATE", { status: order.status });
  if (!notes || !notes.trim()) throw new HttpError(422, "HOTEL_PO_CLOSE_NOTES_REQUIRED");
};

// ── Recepción ──────────────────────────────────────────────────────────────

export interface ReceiptLineQty {
  receivedQty: number;
  acceptedQty: number;
  heldQty: number;
  holdReason?: string | null;
}

/** Aceptado + apartado no puede superar lo recibido; lo apartado exige motivo. */
export const assertReceiptLine = (line: ReceiptLineQty): void => {
  const values = [line.receivedQty, line.acceptedQty, line.heldQty];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  if (line.acceptedQty + line.heldQty - line.receivedQty > EPSILON) throw new HttpError(422, "HOTEL_PO_RECEIPT_QUANTITIES_INVALID");
  if (line.heldQty > EPSILON && !(line.holdReason && line.holdReason.trim())) throw new HttpError(422, "HOTEL_PO_HOLD_REASON_REQUIRED");
};

/** Tope aceptable de lo recibido en total: pedido × (1 + tolerancia %). */
export const toleranceCeiling = (ordered: number, tolerancePct: number): number => round3(ordered * (1 + Math.max(0, tolerancePct) / 100));

/** ¿Lo acumulado (aceptado + apartado abierto + esta recepción) supera la tolerancia? */
export const exceedsTolerance = (ordered: number, cumulative: number, tolerancePct: number): boolean =>
  cumulative - toleranceCeiling(ordered, tolerancePct) > EPSILON;

/**
 * Pasar la tolerancia (P3) exige notas y permiso de aprobar. Recibir más de lo pedido pero dentro de la
 * tolerancia no pide nada.
 */
export const assertToleranceAllowed = (exceeded: boolean, notes: string | null | undefined, canApprove: boolean): void => {
  if (!exceeded) return;
  if (!notes || !notes.trim()) throw new HttpError(422, "HOTEL_PO_OVER_NOTES_REQUIRED");
  if (!canApprove) throw new HttpError(403, "HOTEL_PO_OVER_TOLERANCE_FORBIDDEN");
};

/** Porcentaje de tolerancia desde sys_config (texto). Valor inválido o negativo -> 10. */
export const parseTolerancePct = (raw: string | null | undefined, fallback = 10): number => {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// ── Reposición ─────────────────────────────────────────────────────────────

/**
 * Sugerido de bajo mínimo: cuando lo disponible llegó al mínimo (y hay mínimo), pide hasta el objetivo
 * (máximo o ideal) restando lo que ya viene en OC abiertas.
 */
export const suggestRestock = (input: { available: number; min: number; target: number; pending: number }): number => {
  if (input.min <= 0 || input.available - input.min > EPSILON) return 0;
  return Math.max(0, round3(input.target - input.available - input.pending));
};

/** Lo pendiente de recibir de una línea de OC abierta. */
export const pendingOfLine = (line: { quantity: number; receivedQuantity: number }): number => Math.max(0, round3(line.quantity - line.receivedQuantity));

/** Suma bajas por producto (agregación semanal). */
export const aggregateByProduct = (rows: Array<{ productId: string; quantity: number }>): Array<{ productId: string; quantity: number }> => {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.productId, round3((totals.get(r.productId) ?? 0) + r.quantity));
  return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity })).filter((r) => r.quantity > 0);
};

/** Cruce del mínimo: avisa solo la primera vez; al subir sobre el mínimo se rearma. */
export const lowStockAlertAction = (belowMin: boolean, alreadyAlerted: boolean): "ALERT" | "CLEAR" | "NONE" => {
  if (belowMin && !alreadyAlerted) return "ALERT";
  if (!belowMin && alreadyAlerted) return "CLEAR";
  return "NONE";
};

/** Siete días desde el inicio de la semana: [from, to) y el último día para mostrar. */
export const weekRange = (from: Date): { from: Date; to: Date; last: Date } => {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return { from: start, to: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7), last: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6) };
};
