import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Pure rules of physical counts (M4). No database access: the stocktake service
 * uses them, and the unit tests cover them.
 */

export type HotelStocktakeStatus = "DRAFT" | "COUNTING" | "PENDING_APPROVAL" | "APPLIED" | "CANCELLED";

/** A count still blocks a new one for the same warehouse. */
export const OPEN_STOCKTAKE_STATUSES: HotelStocktakeStatus[] = ["DRAFT", "COUNTING", "PENDING_APPROVAL"];

type Action = "start" | "close" | "approve" | "cancel";

const TRANSITIONS: Record<Action, { from: HotelStocktakeStatus[]; to: HotelStocktakeStatus }> = {
  start: { from: ["DRAFT"], to: "COUNTING" },
  close: { from: ["COUNTING"], to: "PENDING_APPROVAL" },
  approve: { from: ["PENDING_APPROVAL"], to: "APPLIED" },
  cancel: { from: ["DRAFT", "COUNTING", "PENDING_APPROVAL"], to: "CANCELLED" },
};

/** Returns the target status, or 409 when the action is not allowed from the current one. */
export const nextStocktakeStatus = (current: HotelStocktakeStatus, action: Action): HotelStocktakeStatus => {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) throw new HttpError(409, "HOTEL_STOCKTAKE_INVALID_STATE");
  return rule.to;
};

/**
 * Difference to adjust for one line: what was counted, minus the photo taken at the
 * start, minus the net movements posted after it (M4 + decision P2).
 */
export const countDifference = (counted: number, systemQty: number, movementsSincePhoto: number): number =>
  counted - systemQty - movementsSincePhoto;

/** Every line must be counted (a zero is captured explicitly). */
export const assertAllCounted = (lines: Array<{ countedQty: number | null }>): void => {
  if (lines.some((line) => line.countedQty === null)) {
    throw new HttpError(422, "HOTEL_STOCKTAKE_LINES_UNCOUNTED");
  }
};

/** Counts quantity must be zero or more. */
export const assertCountedQuantity = (quantity: number): void => {
  if (!Number.isFinite(quantity) || quantity < 0) throw new HttpError(422, "HOTEL_COUNT_QUANTITY_INVALID");
};

/** Positive differences become inbound adjustments, negative ones outbound (absolute values). */
export const splitAdjustments = <T extends { difference: number }>(
  diffs: T[]
): { inbound: T[]; outbound: Array<T & { difference: number }> } => ({
  inbound: diffs.filter((d) => d.difference > 0),
  outbound: diffs.filter((d) => d.difference < 0),
});
