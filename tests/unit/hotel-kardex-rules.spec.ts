import { test, expect } from "@playwright/test";
import {
  assertDifferentLocations,
  assertMovementShape,
  assertSufficientStock,
  invertDeltas,
  isCancellable,
  ledgerDeltas,
  type HotelMovementType,
} from "../../src/modules/hotel-store/services/kardex-rules";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "UNKNOWN";
  }
};

const line = { quantity: 1 };

test.describe("M3 ledger signs per movement type", () => {
  const expected: Record<HotelMovementType, { source: number; target: number }> = {
    INITIAL_LOAD: { source: 0, target: 1 },
    INBOUND: { source: 0, target: 1 },
    ADJUST_IN: { source: 0, target: 1 },
    TRANSFER: { source: -1, target: 1 },
    LINEN_EXCHANGE: { source: -1, target: 1 },
    ROOM_CONSUMPTION: { source: -1, target: 0 },
    ADJUST_OUT: { source: -1, target: 0 },
    WRITE_OFF: { source: -1, target: 0 },
  };
  for (const [type, signs] of Object.entries(expected)) {
    test(`${type} applies ${signs.source}/${signs.target}`, () => {
      expect(ledgerDeltas(type as HotelMovementType)).toEqual(signs);
    });
  }

  test("cancelling inverts the signs", () => {
    expect(invertDeltas(ledgerDeltas("TRANSFER"))).toEqual({ source: 1, target: -1 });
    expect(invertDeltas(ledgerDeltas("INBOUND"))).toEqual({ source: 0, target: -1 });
  });

  test("consumption and linen exchange come from tasks, not from direct cancellation", () => {
    expect(isCancellable("ROOM_CONSUMPTION")).toBe(false);
    expect(isCancellable("LINEN_EXCHANGE")).toBe(false);
    expect(isCancellable("TRANSFER")).toBe(true);
  });
});

test.describe("M3 movement shape", () => {
  test("transfer needs a source and a target", () => {
    expect(codeOf(() => assertMovementShape("TRANSFER", { fromWarehouseId: "a", warehouseId: "b", lines: [line] }))).toBeNull();
    expect(codeOf(() => assertMovementShape("TRANSFER", { warehouseId: "b", lines: [line] }))).toBe("HOTEL_MOVEMENT_SOURCE_REQUIRED");
    expect(codeOf(() => assertMovementShape("TRANSFER", { fromWarehouseId: "a", lines: [line] }))).toBe("HOTEL_MOVEMENT_TARGET_REQUIRED");
  });

  test("inbound takes no source; write-off takes no target", () => {
    expect(codeOf(() => assertMovementShape("INBOUND", { warehouseId: "b", lines: [line] }))).toBeNull();
    expect(codeOf(() => assertMovementShape("INBOUND", { fromWarehouseId: "a", warehouseId: "b", lines: [line] }))).toBe(
      "HOTEL_MOVEMENT_SOURCE_NOT_ALLOWED"
    );
    expect(codeOf(() => assertMovementShape("WRITE_OFF", { fromWarehouseId: "a", reasonId: "r", lines: [line] }))).toBeNull();
    expect(codeOf(() => assertMovementShape("WRITE_OFF", { fromWarehouseId: "a", warehouseId: "b", reasonId: "r", lines: [line] }))).toBe(
      "HOTEL_MOVEMENT_TARGET_NOT_ALLOWED"
    );
  });

  test("consumption needs a room; adjustments and write-offs need a reason", () => {
    expect(codeOf(() => assertMovementShape("ROOM_CONSUMPTION", { fromWarehouseId: "a", lines: [line] }))).toBe("HOTEL_ROOM_REQUIRED");
    expect(codeOf(() => assertMovementShape("ROOM_CONSUMPTION", { fromWarehouseId: "a", roomId: "r", lines: [line] }))).toBeNull();
    expect(codeOf(() => assertMovementShape("WRITE_OFF", { fromWarehouseId: "a", lines: [line] }))).toBe("HOTEL_MOVEMENT_REASON_REQUIRED");
  });

  test("a movement needs lines with positive quantities", () => {
    expect(codeOf(() => assertMovementShape("INBOUND", { warehouseId: "b", lines: [] }))).toBe("HOTEL_MOVEMENT_LINES_REQUIRED");
    expect(codeOf(() => assertMovementShape("INBOUND", { warehouseId: "b", lines: [{ quantity: 0 }] }))).toBe("HOTEL_QUANTITY_INVALID");
    expect(codeOf(() => assertMovementShape("INBOUND", { warehouseId: "b", lines: [{ quantity: -2 }] }))).toBe("HOTEL_QUANTITY_INVALID");
  });
});

test.describe("M3 stock and locations", () => {
  test("stock never goes negative", () => {
    expect(codeOf(() => assertSufficientStock("p", 5, 5))).toBeNull();
    expect(codeOf(() => assertSufficientStock("p", 4, 5))).toBe("HOTEL_STOCK_INSUFFICIENT");
  });

  test("a transfer within one warehouse needs two different locations", () => {
    expect(codeOf(() => assertDifferentLocations("l1", "l2"))).toBeNull();
    expect(codeOf(() => assertDifferentLocations("l1", "l1"))).toBe("HOTEL_TRANSFER_SAME_LOCATION");
  });
});

import { diffStock, expectedStock } from "../../src/modules/hotel-store/services/kardex-rules";

test.describe("M3 reconciliation (3.5)", () => {
  const inbound = {
    type: "INBOUND" as const,
    fromWarehouseId: null,
    warehouseId: "central",
    lines: [{ productId: "soap", quantity: 10, fromLocationId: null, toLocationId: "central-general" }],
  };
  const transfer = {
    type: "TRANSFER" as const,
    fromWarehouseId: "central",
    warehouseId: "cart-1",
    lines: [{ productId: "soap", quantity: 4, fromLocationId: "central-general", toLocationId: "cart-1-cart" }],
  };

  test("expected stock is the signed sum of the ledger", () => {
    const expected = expectedStock([inbound, transfer]);
    expect(expected.get("soap|central|central-general")?.quantity).toBe(6);
    expect(expected.get("soap|cart-1|cart-1-cart")?.quantity).toBe(4);
  });

  test("a row that disagrees with the ledger is reported, a matching one is not", () => {
    const expected = expectedStock([inbound, transfer]);
    const actual = [
      { productId: "soap", warehouseId: "central", locationId: "central-general", quantity: 5 },
      { productId: "soap", warehouseId: "cart-1", locationId: "cart-1-cart", quantity: 4 },
    ];
    expect(diffStock(actual, expected)).toEqual([
      { productId: "soap", warehouseId: "central", locationId: "central-general", quantity: 5, expected: 6, difference: -1 },
    ]);
  });

  test("a missing row counts as zero", () => {
    const diffs = diffStock([], expectedStock([inbound]));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ quantity: 0, expected: 10, difference: -10 });
  });
});
