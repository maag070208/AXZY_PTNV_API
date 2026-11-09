import { HttpError } from "@core/middlewares/error.middleware";

/** Reglas puras de los adicionales a habitación (Etapa 2, paso 11). */

export type ExtraKind = "LINEN" | "CONSUMABLE";
export type ExtraStatus = "REQUESTED" | "DELIVERED" | "COLLECTED" | "MISSING" | "CANCELLED";

const EPSILON = 1e-9;

/** Un adicional es un blanco o un consumible; el equipo se presta por pieza. */
export const extraKindOf = (productKind: string): ExtraKind => {
  if (productKind === "LINEN") return "LINEN";
  if (productKind === "CONSUMABLE") return "CONSUMABLE";
  throw new HttpError(422, "HOTEL_EXTRA_PRODUCT_INVALID");
};

/** Solo se entrega lo solicitado; solo se recolecta lo entregado y solo los blancos. */
export const assertCanDeliver = (status: ExtraStatus): void => {
  if (status !== "REQUESTED") throw new HttpError(409, "HOTEL_EXTRA_INVALID_STATE");
};
export const assertCanCancel = (status: ExtraStatus): void => {
  if (status !== "REQUESTED") throw new HttpError(409, "HOTEL_EXTRA_INVALID_STATE");
};
export const assertCanCollect = (status: ExtraStatus, kind: ExtraKind): void => {
  if (kind !== "LINEN") throw new HttpError(409, "HOTEL_EXTRA_NOT_COLLECTIBLE");
  if (status !== "DELIVERED") throw new HttpError(409, "HOTEL_EXTRA_INVALID_STATE");
};

/** Recolectado de 0 a lo entregado; más es 422. Devuelve el faltante. */
export const missingOf = (quantity: number, collected: number): number => {
  if (!Number.isFinite(collected) || collected < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  if (collected - quantity > EPSILON) throw new HttpError(422, "HOTEL_EXTRA_COLLECT_EXCEEDS");
  return Math.max(0, quantity - collected);
};

/** Estado final de la recolección: completo -> COLLECTED; con faltante -> MISSING. */
export const statusAfterCollect = (missing: number): ExtraStatus => (missing > EPSILON ? "MISSING" : "COLLECTED");

/** Reparte lo recolectado entre los lotes de salida, en orden (cada uno hasta lo que salió de él). */
export const splitByLots = (lines: Array<{ lotId: string; quantity: number }>, collected: number) => {
  let left = collected;
  const out: Array<{ lotId: string; quantity: number }> = [];
  for (const line of lines) {
    if (left <= EPSILON) break;
    const take = Math.min(line.quantity, left);
    out.push({ lotId: line.lotId, quantity: take });
    left -= take;
  }
  return out;
};
