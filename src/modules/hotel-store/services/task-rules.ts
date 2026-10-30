import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Pure rules of housekeeping tasks (M5). No database access: the housekeeping service
 * uses them inside its transactions, and the unit tests cover them.
 */

export type HotelRoomStatus =
  | "CLEANING"
  | "INSPECTION"
  | "AVAILABLE"
  | "OCCUPIED"
  | "MAINTENANCE"
  | "OUT_OF_SERVICE";

export type HotelCleaningType = "CHECKOUT" | "STAY" | "TURNDOWN";
export type HotelTaskStatus = "PENDING" | "IN_PROGRESS" | "FINISHED" | "CANCELLED";

/**
 * Room status after a task finishes (M5 4.4, step 7). Only a room that is still
 * being cleaned changes, and a stay (occupied room) never changes. A rework task
 * sends the room back to inspection.
 */
export const roomStatusAfterFinish = (input: {
  roomStatus: HotelRoomStatus;
  cleaningType: HotelCleaningType;
  isRework: boolean;
  requiresInspection: boolean;
}): HotelRoomStatus | null => {
  if (input.roomStatus !== "CLEANING") return null;
  if (input.isRework) return "INSPECTION";
  if (input.cleaningType === "STAY") return null;
  return input.requiresInspection ? "INSPECTION" : "AVAILABLE";
};

/** Linen (textile) lines travel to the laundry; the rest are consumed from the cart. */
export const splitLinenLines = <T extends { kind: string }>(lines: T[]): { consumed: T[]; linen: T[] } => ({
  consumed: lines.filter((line) => line.kind !== "LINEN"),
  linen: lines.filter((line) => line.kind === "LINEN"),
});

/** Only pending or in-progress tasks can change assignment or be cancelled. */
export const assertAssignable = (status: HotelTaskStatus): void => {
  if (status !== "PENDING") throw new HttpError(409, "HOTEL_TASK_NOT_PENDING");
};

/** Starting, adding extras or finishing needs the right state. */
export const assertOperable = (status: HotelTaskStatus): void => {
  if (status !== "PENDING" && status !== "IN_PROGRESS") throw new HttpError(409, "HOTEL_TASK_INVALID_STATE");
};

export const assertStartable = (status: HotelTaskStatus): void => {
  if (status !== "PENDING") throw new HttpError(409, "HOTEL_TASK_INVALID_STATE");
};

export const assertCancellable = (status: HotelTaskStatus): void => {
  if (status !== "PENDING" && status !== "IN_PROGRESS") throw new HttpError(409, "HOTEL_TASK_INVALID_STATE");
};

/** A rejection needs a reason from the catalog; an approval does not. */
export const assertInspectionReason = (result: "APPROVED" | "REJECTED", reasonId: string | null | undefined): void => {
  if (result === "REJECTED" && !reasonId) throw new HttpError(422, "HOTEL_REASON_REQUIRED");
};
