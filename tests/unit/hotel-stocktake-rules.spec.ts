import { test, expect } from "@playwright/test";
import {
  assertAllCounted,
  assertCountedQuantity,
  countDifference,
  nextStocktakeStatus,
  splitAdjustments,
} from "../../src/modules/hotel-store/services/stocktake-rules";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "UNKNOWN";
  }
};

test.describe("M4-U01 count differences", () => {
  test("counted minus photo minus movements since the photo", () => {
    expect(countDifference(38, 40, 0)).toBe(-2);
    expect(countDifference(12, 0, 0)).toBe(12);
    expect(countDifference(10, 8, 2)).toBe(0);
    // A movement after the photo that took 3 out: the count must not blame the photo for it.
    expect(countDifference(7, 10, -3)).toBe(0);
  });

  test("differences split into inbound and outbound adjustments", () => {
    const split = splitAdjustments([
      { id: "a", difference: -2 },
      { id: "b", difference: 12 },
      { id: "c", difference: 0 },
    ]);
    expect(split.inbound.map((d) => d.id)).toEqual(["b"]);
    expect(split.outbound.map((d) => d.id)).toEqual(["a"]);
  });
});

test.describe("M4-U02 stocktake states", () => {
  test("the normal path: start, close, approve", () => {
    expect(nextStocktakeStatus("DRAFT", "start")).toBe("COUNTING");
    expect(nextStocktakeStatus("COUNTING", "close")).toBe("PENDING_APPROVAL");
    expect(nextStocktakeStatus("PENDING_APPROVAL", "approve")).toBe("APPLIED");
  });

  test("cancel is allowed while open, not after approval", () => {
    expect(nextStocktakeStatus("DRAFT", "cancel")).toBe("CANCELLED");
    expect(nextStocktakeStatus("COUNTING", "cancel")).toBe("CANCELLED");
    expect(nextStocktakeStatus("PENDING_APPROVAL", "cancel")).toBe("CANCELLED");
    expect(codeOf(() => nextStocktakeStatus("APPLIED", "cancel"))).toBe("HOTEL_STOCKTAKE_INVALID_STATE");
  });

  test("invalid jumps are refused", () => {
    expect(codeOf(() => nextStocktakeStatus("DRAFT", "close"))).toBe("HOTEL_STOCKTAKE_INVALID_STATE");
    expect(codeOf(() => nextStocktakeStatus("COUNTING", "approve"))).toBe("HOTEL_STOCKTAKE_INVALID_STATE");
    expect(codeOf(() => nextStocktakeStatus("CANCELLED", "start"))).toBe("HOTEL_STOCKTAKE_INVALID_STATE");
  });
});

test.describe("M4 closing and captured counts", () => {
  test("closing refuses lines without a count", () => {
    expect(codeOf(() => assertAllCounted([{ countedQty: 3 }, { countedQty: 0 }]))).toBeNull();
    expect(codeOf(() => assertAllCounted([{ countedQty: 3 }, { countedQty: null }]))).toBe("HOTEL_STOCKTAKE_LINES_UNCOUNTED");
  });

  test("counts are zero or more", () => {
    expect(codeOf(() => assertCountedQuantity(0))).toBeNull();
    expect(codeOf(() => assertCountedQuantity(-1))).toBe("HOTEL_COUNT_QUANTITY_INVALID");
  });
});
