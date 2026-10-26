import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del catálogo de M2 (productos y kits). Sin base de datos: las
 * usan los servicios y las pruebas unitarias.
 */

export type HotelKitFrequency = "CADA_LIMPIEZA" | "SOLO_CHECKOUT" | "CADA_N_DIAS";
export type HotelCleaningType = "CHECKOUT" | "ESTANCIA" | "REPASO";
export type HotelProductKind = "CONSUMIBLE" | "TEXTIL" | "QUIMICO" | "EQUIPO";

const DAY_MS = 24 * 60 * 60 * 1000;

/** mínimo ≤ ideal y, si hay sobrestock (> 0), ideal ≤ sobrestock. */
export const assertStockThresholds = (t: { minStock: number; idealStock: number; overstock: number }): void => {
  if (t.minStock > t.idealStock) throw new HttpError(422, "HOTEL_PRODUCT_THRESHOLDS_INVALID");
  if (t.overstock > 0 && t.idealStock > t.overstock) throw new HttpError(422, "HOTEL_PRODUCT_THRESHOLDS_INVALID");
};

/** Unidad entera (pieza, caja): la cantidad debe ser entera. */
export const assertWholeQuantity = (quantity: number, whole: boolean): void => {
  if (whole && !Number.isInteger(quantity)) throw new HttpError(422, "HOTEL_QUANTITY_NOT_WHOLE");
};

/** `everyNDays` solo aplica a `CADA_N_DIAS` (obligatorio y ≥ 1); en otras frecuencias queda en nulo. */
export const normalizeEveryNDays = (frequency: HotelKitFrequency, everyNDays?: number | null): number | null => {
  if (frequency !== "CADA_N_DIAS") return null;
  if (!everyNDays || everyNDays < 1) throw new HttpError(422, "HOTEL_KIT_EVERY_N_DAYS_REQUIRED");
  return everyNDays;
};

/** Un producto EQUIPO tiene existencia y baja, pero no entra a kits ni se consume. */
export const assertKittable = (kind: HotelProductKind): void => {
  if (kind === "EQUIPO") throw new HttpError(409, "HOTEL_PRODUCT_NOT_KITABLE");
};

export interface KitLineRule {
  productId: string;
  quantity: number;
  frequency: HotelKitFrequency;
  everyNDays: number | null;
}

/**
 * Líneas de kit que aplican a una limpieza (tabla de frecuencias de M2):
 * - CADA_LIMPIEZA: check-out y estancia; no repaso.
 * - SOLO_CHECKOUT: solo check-out.
 * - CADA_N_DIAS: siempre en check-out; en estancia solo si pasaron ≥ N días desde
 *   la última limpieza que llevó ese producto (o si nunca lo llevó); no en repaso.
 * `lastAppliedAt` mapea productId → fecha de la última tarea terminada que lo incluyó.
 */
export const resolveKitLines = <T extends KitLineRule>(
  lines: T[],
  cleaning: HotelCleaningType,
  lastAppliedAt: Map<string, Date>,
  now: Date
): T[] =>
  lines.filter((line) => {
    if (cleaning === "REPASO") return false;
    if (line.frequency === "CADA_LIMPIEZA") return true;
    if (line.frequency === "SOLO_CHECKOUT") return cleaning === "CHECKOUT";
    if (cleaning === "CHECKOUT") return true;
    const last = lastAppliedAt.get(line.productId);
    if (!last) return true;
    const days = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
    return days >= (line.everyNDays ?? 1);
  });
