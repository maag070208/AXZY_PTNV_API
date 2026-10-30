import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Pure rules of the M2 catalog (products and kits). No database access: they
 * are used by the services and the unit tests.
 */

export type HotelKitFrequency = "EVERY_CLEANING" | "CHECKOUT_ONLY" | "EVERY_N_DAYS";
export type HotelCleaningType = "CHECKOUT" | "STAY" | "TURNDOWN";
export type HotelProductKind = "CONSUMABLE" | "LINEN" | "CHEMICAL" | "EQUIPMENT";

const DAY_MS = 24 * 60 * 60 * 1000;

/** minimum ≤ ideal and, when there is overstock (> 0), ideal ≤ overstock. */
export const assertStockThresholds = (t: { minStock: number; idealStock: number; overstock: number }): void => {
  if (t.minStock > t.idealStock) throw new HttpError(422, "HOTEL_PRODUCT_THRESHOLDS_INVALID");
  if (t.overstock > 0 && t.idealStock > t.overstock) throw new HttpError(422, "HOTEL_PRODUCT_THRESHOLDS_INVALID");
};

/** Whole unit (piece, box): the quantity must be an integer. */
export const assertWholeQuantity = (quantity: number, whole: boolean): void => {
  if (whole && !Number.isInteger(quantity)) throw new HttpError(422, "HOTEL_QUANTITY_NOT_WHOLE");
};

/** `everyNDays` only applies to `EVERY_N_DAYS` (required and ≥ 1); it stays null for other frequencies. */
export const normalizeEveryNDays = (frequency: HotelKitFrequency, everyNDays?: number | null): number | null => {
  if (frequency !== "EVERY_N_DAYS") return null;
  if (!everyNDays || everyNDays < 1) throw new HttpError(422, "HOTEL_KIT_EVERY_N_DAYS_REQUIRED");
  return everyNDays;
};

/** An EQUIPMENT product has stock and write-offs, but it cannot go into kits or be consumed. */
export const assertKittable = (kind: HotelProductKind): void => {
  if (kind === "EQUIPMENT") throw new HttpError(409, "HOTEL_PRODUCT_NOT_KITABLE");
};

export interface KitLineRule {
  productId: string;
  quantity: number;
  frequency: HotelKitFrequency;
  everyNDays: number | null;
}

/**
 * Kit lines that apply to a cleaning (M2 frequency table):
 * - EVERY_CLEANING: checkout and stay-over; not turndown.
 * - CHECKOUT_ONLY: checkout only.
 * - EVERY_N_DAYS: always at checkout; at stay-over only if ≥ N days passed since
 *   the last cleaning that included this product (or if it never did); not at turndown.
 * `lastAppliedAt` maps productId → date of the last finished task that included it.
 */
export const resolveKitLines = <T extends KitLineRule>(
  lines: T[],
  cleaning: HotelCleaningType,
  lastAppliedAt: Map<string, Date>,
  now: Date
): T[] =>
  lines.filter((line) => {
    if (cleaning === "TURNDOWN") return false;
    if (line.frequency === "EVERY_CLEANING") return true;
    if (line.frequency === "CHECKOUT_ONLY") return cleaning === "CHECKOUT";
    if (cleaning === "CHECKOUT") return true;
    const last = lastAppliedAt.get(line.productId);
    if (!last) return true;
    const days = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
    return days >= (line.everyNDays ?? 1);
  });
