import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del pedido de área (Etapa 2, pasos 5-7): origen según el tipo de producto,
 * sugerido, estado tras surtir y confirmación. Sin acceso a base de datos.
 */

const EPSILON = 1e-9;

export type SupplyRequestStatusLike = "DRAFT" | "SUBMITTED" | "PARTIALLY_FULFILLED" | "FULFILLED" | "RECEIVED" | "CANCELLED";

/** Tipos de almacén que pueden pedir. */
export const REQUESTING_KINDS = ["ZONE", "SPA", "POINT"];

/**
 * Almacén que surte según los productos: blancos (LINEN) salen de lavandería; consumibles
 * (CONSUMABLE) del almacén central de amenidades. No se mezclan en un pedido.
 */
export const supplySourceKind = (productKinds: string[]): "LAUNDRY" | "CENTRAL" => {
  const kinds = new Set(productKinds);
  if (kinds.size === 1 && kinds.has("LINEN")) return "LAUNDRY";
  if (kinds.size === 1 && kinds.has("CONSUMABLE")) return "CENTRAL";
  throw new HttpError(422, "HOTEL_SUPPLY_KINDS_INVALID");
};

export interface RoomKitLines {
  lines: Array<{ productId: string; quantity: number }>;
}

/**
 * Sugerido por producto: (salidas + ocupadas) × cantidad promedio del kit para ese producto.
 * El promedio se toma sobre las habitaciones de la zona que tienen kit; la habitación cuyo kit
 * no incluye el producto cuenta con 0. Se redondea hacia arriba (piezas enteras).
 */
export const suggestSupply = (
  rooms: RoomKitLines[],
  checkouts: number,
  occupied: number
): Array<{ productId: string; averagePerRoom: number; quantity: number }> => {
  if (rooms.length === 0) return [];
  const totals = new Map<string, number>();
  for (const room of rooms) {
    for (const line of room.lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  const rooms_ = checkouts + occupied;
  return [...totals.entries()].map(([productId, total]) => {
    const averagePerRoom = total / rooms.length;
    return { productId, averagePerRoom: Math.round(averagePerRoom * 1000) / 1000, quantity: Math.ceil(averagePerRoom * rooms_ - EPSILON) };
  });
};

export const pendingQty = (line: { requestedQty: number; deliveredQty: number }): number =>
  Math.max(0, line.requestedQty - line.deliveredQty);

/** Cada surtido debe ser positivo y no exceder lo pendiente del renglón. */
export const assertDeliverable = (pending: number, delivering: number): void => {
  if (!Number.isFinite(delivering) || delivering < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  if (delivering - pending > EPSILON) throw new HttpError(422, "HOTEL_SUPPLY_DELIVERED_EXCEEDS");
};

/** Tras surtir: todo cubierto -> FULFILLED; si queda algo pendiente -> PARTIALLY_FULFILLED. */
export const statusAfterFulfill = (lines: Array<{ requestedQty: number; deliveredQty: number }>): "PARTIALLY_FULFILLED" | "FULFILLED" =>
  lines.every((l) => pendingQty(l) <= EPSILON) ? "FULFILLED" : "PARTIALLY_FULFILLED";

export const canFulfill = (status: string): boolean => status === "SUBMITTED" || status === "PARTIALLY_FULFILLED";

/**
 * Confirmar (supervisora): pedido surtido (completo o parcial) y sin traspasos en tránsito.
 * Un pedido PARTIALLY_FULFILLED se puede cerrar sin esperar el resto: queda RECEIVED con los pendientes anotados.
 */
export const assertCanConfirm = (status: string, inTransitTransfers: number): void => {
  if (status !== "FULFILLED" && status !== "PARTIALLY_FULFILLED") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  if (inTransitTransfers > 0) throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_PENDING_RECEIPT");
};

/** Estado al confirmar (siempre RECEIVED) y renglones con pendiente que se anotan al cerrar. */
export const closeOutcome = (
  lines: Array<{ code: string; requestedQty: number; deliveredQty: number }>
): { status: "RECEIVED"; closedWithPending: boolean; pending: Array<{ code: string; quantity: number }> } => {
  const pending = lines.filter((l) => pendingQty(l) > EPSILON).map((l) => ({ code: l.code, quantity: pendingQty(l) }));
  return { status: "RECEIVED", closedWithPending: pending.length > 0, pending };
};

/** Ids de una zona y todos sus descendientes. */
export const zoneSubtree = (zones: Array<{ id: string; parentId: string | null }>, rootId: string): Set<string> => {
  const children = new Map<string, string[]>();
  for (const z of zones) {
    if (!z.parentId) continue;
    children.set(z.parentId, [...(children.get(z.parentId) ?? []), z.id]);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
};
