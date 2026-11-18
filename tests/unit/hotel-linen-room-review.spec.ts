import { test, expect } from "@playwright/test";
import { buildReviewLines, consolidate, reviewTotals, validateCounted } from "../../src/modules/hotel-store/linen/services/room-review-rules";

const expected = new Map([
  ["towel", 6],
  ["sheet", 5],
]);

test.describe("buildReviewLines", () => {
  test("diferencia = contado − esperado y esperado no capturado cuenta 0", () => {
    const lines = buildReviewLines(expected, [{ productId: "towel", counted: 4 }]);
    expect(lines).toEqual([
      { productId: "towel", expected: 6, counted: 4, diff: -2, unexpected: false },
      { productId: "sheet", expected: 5, counted: 0, diff: -5, unexpected: false },
    ]);
  });

  test("artículo no esperado sale como unexpected y con 0 se omite", () => {
    const lines = buildReviewLines(expected, [
      { productId: "towel", counted: 7 },
      { productId: "sheet", counted: 5 },
      { productId: "robe", counted: 2 },
      { productId: "mat", counted: 0 },
    ]);
    expect(lines.find((l) => l.productId === "towel")?.diff).toBe(1);
    expect(lines.find((l) => l.productId === "robe")).toEqual({ productId: "robe", expected: 0, counted: 2, diff: 2, unexpected: true });
    expect(lines.some((l) => l.productId === "mat")).toBe(false);
  });
});

test.describe("reviewTotals", () => {
  test("faltante y sobrante se suman por separado", () => {
    const lines = buildReviewLines(expected, [
      { productId: "towel", counted: 8 },
      { productId: "sheet", counted: 3 },
      { productId: "robe", counted: 1 },
    ]);
    expect(reviewTotals(lines)).toEqual({ expected: 11, counted: 12, missing: 2, surplus: 3 });
  });
});

test.describe("validateCounted", () => {
  test("rechaza negativos, decimales y repetidos", () => {
    expect(validateCounted([{ productId: "a", counted: -1 }])?.code).toBe("HOTEL_ROOM_REVIEW_COUNT_INVALID");
    expect(validateCounted([{ productId: "a", counted: 1.5 }])?.code).toBe("HOTEL_ROOM_REVIEW_COUNT_INVALID");
    expect(validateCounted([{ productId: "a", counted: 1 }, { productId: "a", counted: 2 }])).toEqual({ index: 1, code: "HOTEL_ROOM_REVIEW_DUPLICATE" });
    expect(validateCounted([{ productId: "a", counted: 0 }])).toBeNull();
  });
});

test.describe("consolidate", () => {
  test("agrupa por artículo y por responsable", () => {
    const out = consolidate([
      { reviewId: "r1", responsibleId: "u1", productId: "towel", expected: 6, counted: 4 },
      { reviewId: "r1", responsibleId: "u1", productId: "sheet", expected: 5, counted: 6 },
      { reviewId: "r2", responsibleId: "u1", productId: "towel", expected: 6, counted: 6 },
      { reviewId: "r3", responsibleId: "u2", productId: "towel", expected: 6, counted: 3 },
    ]);
    expect(out.byProduct.find((p) => p.productId === "towel")).toEqual({ productId: "towel", expected: 18, counted: 13, missing: 5, surplus: 0 });
    expect(out.byProduct.find((p) => p.productId === "sheet")).toEqual({ productId: "sheet", expected: 5, counted: 6, missing: 0, surplus: 1 });
    expect(out.byResponsible.find((r) => r.responsibleId === "u1")).toEqual({ responsibleId: "u1", reviews: 2, missing: 2, surplus: 1 });
    expect(out.byResponsible.find((r) => r.responsibleId === "u2")).toEqual({ responsibleId: "u2", reviews: 1, missing: 3, surplus: 0 });
  });
});
