import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del pedido de área (Etapa 2, pasos 5-7): origen según el tipo de producto,
 * sugerido, estado tras surtir y confirmación. Sin acceso a base de datos.
 */

const EPSILON = 1e-9;

export type SupplyRequestStatusLike =
  | "DRAFT"
  | "SUBMITTED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "RECEIVED"
  | "CANCELLED"
  | "READY_FOR_PICKUP"
  | "IN_TRANSIT";

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
export const assertCanConfirm = (status: string, inTransitTransfers: number, origin: string = "MANUAL"): void => {
  // Los pedidos por habitación se cierran solos al entregarse (RECEIVED): no se confirman.
  if (origin === "ROOM_TURNOVER") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
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

// ── Pedido por habitación (tablet) ───────────────────────────────────────────

/** Estados en los que un pedido por habitación sigue abierto (aún no entregado ni cancelado; la entrega lo cierra como RECEIVED). */
export const OPEN_TURNOVER_STATUSES = ["SUBMITTED", "PARTIALLY_FULFILLED", "READY_FOR_PICKUP", "IN_TRANSIT"] as const;

/** Cadena de zonas desde la zona dada hacia arriba (ella primero). Tolera ciclos. */
export const zoneChainUp = (zones: Array<{ id: string; parentId: string | null }>, zoneId: string): string[] => {
  const parentOf = new Map(zones.map((z) => [z.id, z.parentId]));
  const chain: string[] = [];
  for (let z: string | null | undefined = zoneId; z && !chain.includes(z); z = parentOf.get(z)) chain.push(z);
  return chain;
};

/** Almacén de piso de una habitación: el de la zona más cercana (la de la habitación o un ancestro). */
export const nearestAreaWarehouse = <W extends { id: string; zoneId: string | null }>(chain: string[], warehouses: W[]): W | null => {
  for (const zoneId of chain) {
    const found = warehouses.find((w) => w.zoneId === zoneId);
    if (found) return found;
  }
  return null;
};

/**
 * Renglones finales del pedido por habitación. Sin `custom` se usa el sugerido; con `custom`
 * (la supervisora ajustó o agregó piezas) manda esa lista. Se descartan cantidades en 0, no se
 * repiten productos y cada cantidad debe ser un número positivo.
 */
export const turnoverLines = (
  suggested: Array<{ productId: string; quantity: number }>,
  custom?: Array<{ productId: string; requestedQty: number }> | null
): Array<{ productId: string; requestedQty: number }> => {
  const source = custom ? custom.map((l) => ({ productId: l.productId, quantity: l.requestedQty })) : suggested;
  const seen = new Set<string>();
  const out: Array<{ productId: string; requestedQty: number }> = [];
  for (const line of source) {
    if (!Number.isFinite(line.quantity) || line.quantity < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
    if (seen.has(line.productId)) throw new HttpError(422, "HOTEL_SUPPLY_LINES_DUPLICATE");
    seen.add(line.productId);
    if (line.quantity > 0) out.push({ productId: line.productId, requestedQty: line.quantity });
  }
  if (out.length === 0) throw new HttpError(422, "HOTEL_SUPPLY_NOTHING_TO_REQUEST");
  return out;
};

/** Al surtir un pedido por habitación queda listo para recoger (aunque falte algo: lo pendiente se anota al confirmar). */
export const statusAfterTurnoverFulfill = (): "READY_FOR_PICKUP" => "READY_FOR_PICKUP";

/** Recoger: solo un pedido por habitación listo y sin portador. El primero que lo toma se queda con él. */
export const assertCanPickup = (request: { status: string; origin: string; carrierUserId: string | null }): void => {
  if (request.origin !== "ROOM_TURNOVER" || request.status !== "READY_FOR_PICKUP") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  if (request.carrierUserId) throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_ALREADY_TAKEN");
};

/** Al entregar un pedido por habitación se cierra solo: queda RECEIVED (ya no pasa por "por confirmar"). */
export const statusAfterTurnoverDeliver = (): "RECEIVED" => "RECEIVED";

/** Recoger varios en un viaje: separa los ids tomados de los que no (otro los tomó o ya no están listos). Sin repetidos. */
export const splitPickupResults = (ids: string[], pickedIds: Iterable<string>): { picked: string[]; conflicts: string[] } => {
  const picked = new Set(pickedIds);
  const unique = [...new Set(ids)];
  return { picked: unique.filter((id) => picked.has(id)), conflicts: unique.filter((id) => !picked.has(id)) };
};

/**
 * Sucio recogido al entregar: por omisión lo entregado (recibido) de cada renglón; con `dirty` manda esa lista.
 * Solo productos del pedido, cantidades enteras >= 0, sin repetir. Informativo (no mueve inventario).
 */
export const resolveDirtyLines = (
  lines: Array<{ productId: string; deliveredQty: number }>,
  dirty?: Array<{ productId: string; quantity: number }> | null
): Array<{ productId: string; quantity: number }> => {
  if (!dirty) return lines.map((l) => ({ productId: l.productId, quantity: Math.floor(l.deliveredQty + EPSILON) }));
  const known = new Set(lines.map((l) => l.productId));
  const seen = new Set<string>();
  for (const d of dirty) {
    if (!known.has(d.productId)) throw new HttpError(422, "HOTEL_SUPPLY_LINE_NOT_ON_REQUEST");
    if (seen.has(d.productId)) throw new HttpError(422, "HOTEL_SUPPLY_LINES_DUPLICATE");
    seen.add(d.productId);
    if (!Number.isInteger(d.quantity) || d.quantity < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  }
  return dirty.map((d) => ({ productId: d.productId, quantity: d.quantity }));
};

/**
 * Reportar diferencia (supervisora): solo un pedido por habitación ya RECEIVED, con notas, y cada faltante
 * positivo, de un producto del pedido y sin exceder lo recibido. Devuelve los renglones a dar de baja.
 */
export const assertDifferenceReport = (
  request: { status: string; origin: string },
  lines: Array<{ productId: string; receivedQty: number }>,
  missing: Array<{ productId: string; missingQty: number }>,
  notes: string | null | undefined
): Array<{ productId: string; quantity: number }> => {
  if (request.origin !== "ROOM_TURNOVER" || request.status !== "RECEIVED") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  if (!notes || !notes.trim()) throw new HttpError(422, "HOTEL_SUPPLY_DIFFERENCE_NOTES_REQUIRED");
  if (missing.length === 0) throw new HttpError(422, "HOTEL_MOVEMENT_LINES_REQUIRED");
  const byProduct = new Map(lines.map((l) => [l.productId, l.receivedQty]));
  const seen = new Set<string>();
  for (const m of missing) {
    if (!byProduct.has(m.productId)) throw new HttpError(422, "HOTEL_SUPPLY_LINE_NOT_ON_REQUEST");
    if (seen.has(m.productId)) throw new HttpError(422, "HOTEL_SUPPLY_LINES_DUPLICATE");
    seen.add(m.productId);
    if (!Number.isFinite(m.missingQty) || m.missingQty <= 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
    if (m.missingQty - byProduct.get(m.productId)! > EPSILON) throw new HttpError(422, "HOTEL_SUPPLY_DIFFERENCE_EXCEEDS");
  }
  return missing.map((m) => ({ productId: m.productId, quantity: m.missingQty }));
};

/** Agregar extras (supervisora): solo mientras el pedido por habitación espera a lavandería (SUBMITTED). */
export const assertCanAddLines = (request: { status: string; origin: string }): void => {
  if (request.origin !== "ROOM_TURNOVER" || request.status !== "SUBMITTED") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
};

/** Entregar: solo quien lo recogió y mientras va en camino. */
export const assertCanDeliver = (request: { status: string; origin: string; carrierUserId: string | null }, userId: string): void => {
  if (request.origin !== "ROOM_TURNOVER" || request.status !== "IN_TRANSIT") throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  if (request.carrierUserId !== userId) throw new HttpError(403, "HOTEL_SUPPLY_REQUEST_NOT_CARRIER");
};

/** Minutos transcurridos entre dos instantes (para medir tiempos de la cola); nunca negativos. */
export const minutesBetween = (from: Date, to: Date): number => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));

/** Grupo visual de un pedido por habitación en la app de blancos (pendiente / en proceso / lista). */
export type TurnoverBucket = "PENDING" | "IN_PROGRESS" | "DONE";

/**
 * Pendiente = lavandería aún no lo deja listo; en proceso = listo para recoger o en camino;
 * lista = entregado en la habitación (por confirmar) o ya confirmado.
 */
export const turnoverBucket = (status: string): TurnoverBucket => {
  if (status === "READY_FOR_PICKUP" || status === "IN_TRANSIT") return "IN_PROGRESS";
  if (status === "FULFILLED" || status === "RECEIVED") return "DONE";
  return "PENDING";
};

/** Estados que se muestran en la app de blancos (sin borradores ni cancelados). */
export const VISIBLE_TURNOVER_STATUSES = [...OPEN_TURNOVER_STATUSES, "RECEIVED"] as const;
