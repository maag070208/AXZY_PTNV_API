import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del traspaso con doble firma (D6) y del semáforo de par. Sin acceso a base
 * de datos: los servicios las usan y las pruebas unitarias las cubren.
 */

export type TransferStatus = "IN_TRANSIT" | "ACTIVE" | "RECEIVED_WITH_DIFFERENCE" | "CANCELLED" | "PENDING_APPROVAL";

const EPSILON = 1e-9;

/** Separación de funciones: quien recibe no puede ser quien envió (creó o firmó la entrega). */
export const assertDifferentUsers = (senderIds: Array<string | null | undefined>, receiverId: string): void => {
  if (senderIds.some((id) => id && id === receiverId)) throw new HttpError(409, "HOTEL_TRANSFER_SAME_USER");
};

/** Lo contado va de 0 a lo enviado; más de lo enviado es 422. */
export const assertReceivedQuantity = (sent: number, received: number): void => {
  if (!Number.isFinite(received) || received < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  if (received - sent > EPSILON) throw new HttpError(422, "HOTEL_TRANSFER_RECEIVED_EXCEEDS");
};

/** Faltante de una línea: lo enviado menos lo contado (nunca negativo). */
export const lineShortfall = (sent: number, received: number): number => Math.max(0, sent - received);

/** Todo cuadra -> ACTIVE; si alguna línea difiere -> RECEIVED_WITH_DIFFERENCE. */
export const receptionStatus = (
  lines: Array<{ quantity: number; receivedQuantity: number }>
): "ACTIVE" | "RECEIVED_WITH_DIFFERENCE" =>
  lines.some((l) => Math.abs(l.quantity - l.receivedQuantity) > EPSILON) ? "RECEIVED_WITH_DIFFERENCE" : "ACTIVE";

/** Cancelar: solo en tránsito, y solo el emisor o quien aprueba ajustes. */
export const assertCanCancelTransfer = (
  status: string,
  actorId: string,
  senderIds: Array<string | null | undefined>,
  canApprove: boolean
): void => {
  if (status !== "IN_TRANSIT") throw new HttpError(409, "HOTEL_TRANSFER_NOT_IN_TRANSIT");
  if (!canApprove && !senderIds.some((id) => id === actorId)) throw new HttpError(403, "HOTEL_TRANSFER_CANCEL_FORBIDDEN");
};

export type StockLight = "green" | "yellow" | "red" | "none";

/** Semáforo contra el par (criterio de la demo): >= 100 % verde, >= 90 % amarillo, menos rojo; sin par, none. */
export const stockLight = (total: number, par: number, yellowFrom = 0.9): StockLight => {
  if (!(par > 0)) return "none";
  if (total >= par) return "green";
  return total >= par * yellowFrom ? "yellow" : "red";
};
