import { test, expect } from "@playwright/test";
import {
  assertAssignable,
  assertCancellable,
  assertInspectionReason,
  assertOperable,
  assertStartable,
  roomStatusAfterFinish,
  splitLinenLines,
} from "../../src/modules/hotel-store/services/task-rules";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "UNKNOWN";
  }
};

test.describe("M5-U02 room status after a task finishes", () => {
  const base = { roomStatus: "CLEANING" as const, isRework: false, requiresInspection: false };
  test("a checkout that is still being cleaned becomes available, or inspection when required", () => {
    expect(roomStatusAfterFinish({ ...base, cleaningType: "CHECKOUT" })).toBe("AVAILABLE");
    expect(roomStatusAfterFinish({ ...base, cleaningType: "CHECKOUT", requiresInspection: true })).toBe("INSPECTION");
    expect(roomStatusAfterFinish({ ...base, cleaningType: "TURNDOWN" })).toBe("AVAILABLE");
  });

  test("a stay never changes the room", () => {
    expect(roomStatusAfterFinish({ ...base, cleaningType: "STAY", requiresInspection: true })).toBeNull();
  });

  test("a room under maintenance keeps its status when its task finishes", () => {
    expect(roomStatusAfterFinish({ ...base, roomStatus: "MAINTENANCE", cleaningType: "CHECKOUT" })).toBeNull();
    expect(roomStatusAfterFinish({ ...base, roomStatus: "OCCUPIED", cleaningType: "STAY" })).toBeNull();
  });

  test("a rework always sends the room back to inspection", () => {
    expect(roomStatusAfterFinish({ ...base, cleaningType: "CHECKOUT", isRework: true })).toBe("INSPECTION");
  });
});

test.describe("M5-U04 linen lines are separated from consumed lines", () => {
  test("LINEN goes to the laundry; everything else is consumed", () => {
    const split = splitLinenLines([
      { productId: "soap", kind: "CONSUMABLE" },
      { productId: "sheet", kind: "LINEN" },
      { productId: "towel", kind: "LINEN" },
    ]);
    expect(split.consumed.map((l) => l.productId)).toEqual(["soap"]);
    expect(split.linen.map((l) => l.productId)).toEqual(["sheet", "towel"]);
  });
});

test.describe("M5 task states", () => {
  test("only pending tasks can be assigned", () => {
    expect(codeOf(() => assertAssignable("PENDING"))).toBeNull();
    expect(codeOf(() => assertAssignable("IN_PROGRESS"))).toBe("HOTEL_TASK_NOT_PENDING");
  });

  test("operating needs pending or in-progress; starting needs pending", () => {
    expect(codeOf(() => assertOperable("IN_PROGRESS"))).toBeNull();
    expect(codeOf(() => assertOperable("FINISHED"))).toBe("HOTEL_TASK_INVALID_STATE");
    expect(codeOf(() => assertStartable("PENDING"))).toBeNull();
    expect(codeOf(() => assertStartable("IN_PROGRESS"))).toBe("HOTEL_TASK_INVALID_STATE");
  });

  test("cancelling is allowed while open", () => {
    expect(codeOf(() => assertCancellable("IN_PROGRESS"))).toBeNull();
    expect(codeOf(() => assertCancellable("FINISHED"))).toBe("HOTEL_TASK_INVALID_STATE");
  });

  test("a rejection needs a reason; an approval does not", () => {
    expect(codeOf(() => assertInspectionReason("APPROVED", null))).toBeNull();
    expect(codeOf(() => assertInspectionReason("REJECTED", null))).toBe("HOTEL_REASON_REQUIRED");
    expect(codeOf(() => assertInspectionReason("REJECTED", "reason-1"))).toBeNull();
  });
});
