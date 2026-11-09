import { test, expect } from "@playwright/test";
import { assertStageTransition, averageCycles, isValidTransition } from "../../src/modules/hotel-store/linen/services/laundry-rules";
import {
  assertConditionSplit,
  computeShortage,
  planDirtyMoves,
  shortageRecipients,
} from "../../src/modules/hotel-store/linen/services/dirty-receipt-rules";
import {
  assertCanConfirm,
  assertDeliverable,
  pendingQty,
  statusAfterFulfill,
  suggestSupply,
  supplySourceKind,
  zoneSubtree,
} from "../../src/modules/hotel-store/linen/services/supply-request-rules";
import { resolveDirtyWarehouse } from "../../src/modules/hotel-store/linen/services/dirty-destination";
import { dayRange } from "../../src/modules/hotel-store/linen/services/day-range";

test.describe("Linen F2 laundry: stage transitions", () => {
  test("valid transitions", () => {
    for (const [from, to] of [["DIRTY", "IN_PROCESS"], ["DIRTY", "QUARANTINE"], ["IN_PROCESS", "CLEAN"], ["IN_PROCESS", "QUARANTINE"], ["QUARANTINE", "IN_PROCESS"]]) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  });

  test("anything else is 409 HOTEL_LAUNDRY_STAGE_INVALID", () => {
    for (const [from, to] of [["DIRTY", "CLEAN"], ["IN_PROCESS", "IN_PROCESS"], ["CLEAN", "DIRTY"], ["CLEAN", "IN_PROCESS"], ["QUARANTINE", "CLEAN"], ["QUARANTINE", "DIRTY"]]) {
      expect(() => assertStageTransition(from, to)).toThrow(expect.objectContaining({ status: 409, code: "HOTEL_LAUNDRY_STAGE_INVALID" }));
    }
  });

  test("average cycles = washed / initial", () => {
    expect(averageCycles(150, 100)).toBe(1.5);
    expect(averageCycles(0, 100)).toBe(0);
    expect(averageCycles(10, 0)).toBe(0);
  });
});

test.describe("Linen F2 dirty receipt: shortage and split", () => {
  test("shortage = delivered - received dirty - still in use, never negative", () => {
    expect(computeShortage(100, 80, 15)).toBe(5);
    expect(computeShortage(100, 100, 0)).toBe(0);
    expect(computeShortage(10, 12, 0)).toBe(0);
  });

  test("good + stained + damaged must equal received dirty (422 otherwise)", () => {
    expect(() => assertConditionSplit(10, 6, 3, 1)).not.toThrow();
    expect(() => assertConditionSplit(10, 6, 3, 2)).toThrow(expect.objectContaining({ status: 422, code: "HOTEL_DIRTY_SPLIT_MISMATCH" }));
    expect(() => assertConditionSplit(10, 6, 3, 0)).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => assertConditionSplit(0, 0, 0, 0)).not.toThrow();
  });

  test("plan: dirty location first, the rest from GENERAL; damaged goes to quarantine", () => {
    expect(planDirtyMoves(20, 6, 3, 1)).toEqual([
      { from: "DIRTY", to: "DIRTY", quantity: 9 },
      { from: "DIRTY", to: "QUARANTINE", quantity: 1 },
    ]);
    expect(planDirtyMoves(7, 6, 3, 1)).toEqual([
      { from: "DIRTY", to: "DIRTY", quantity: 7 },
      { from: "GENERAL", to: "DIRTY", quantity: 2 },
      { from: "GENERAL", to: "QUARANTINE", quantity: 1 },
    ]);
    expect(planDirtyMoves(0, 4, 0, 0)).toEqual([{ from: "GENERAL", to: "DIRTY", quantity: 4 }]);
    const total = planDirtyMoves(3, 5, 2, 2).reduce((s, x) => s + x.quantity, 0);
    expect(total).toBe(9);
  });

  test("shortage notices: Spa goes to the Ops manager only", () => {
    expect(shortageRecipients("SPA")).toEqual({ zoneSupervisors: false, roles: ["HOTEL_OPS_MANAGER"] });
    expect(shortageRecipients("ZONE")).toEqual({ zoneSupervisors: true, roles: ["HOTEL_GENERAL_SUPERVISOR"] });
  });
});

test.describe("Linen F2 supply request", () => {
  test("suggestion = (checkouts + occupied) x average kit quantity, rounded up", () => {
    const rooms = [
      { lines: [{ productId: "sheet", quantity: 2 }, { productId: "towel", quantity: 4 }] },
      { lines: [{ productId: "sheet", quantity: 3 }] },
    ];
    const result = suggestSupply(rooms, 5, 10);
    expect(result.find((r) => r.productId === "sheet")).toMatchObject({ averagePerRoom: 2.5, quantity: 38 });
    // towel: (4 + 0) / 2 = 2 por habitación -> 15 x 2
    expect(result.find((r) => r.productId === "towel")).toMatchObject({ averagePerRoom: 2, quantity: 30 });
  });

  test("no rooms means no suggestion", () => {
    expect(suggestSupply([], 5, 5)).toEqual([]);
  });

  test("source depends on the product kind and kinds do not mix", () => {
    expect(supplySourceKind(["LINEN", "LINEN"])).toBe("LAUNDRY");
    expect(supplySourceKind(["CONSUMABLE"])).toBe("CENTRAL");
    expect(() => supplySourceKind(["LINEN", "CONSUMABLE"])).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => supplySourceKind(["CHEMICAL"])).toThrow(expect.objectContaining({ status: 422 }));
  });

  test("status after fulfilling: pending lines keep it PARTIALLY_FULFILLED", () => {
    expect(statusAfterFulfill([{ requestedQty: 10, deliveredQty: 10 }, { requestedQty: 5, deliveredQty: 5 }])).toBe("FULFILLED");
    expect(statusAfterFulfill([{ requestedQty: 10, deliveredQty: 10 }, { requestedQty: 5, deliveredQty: 3 }])).toBe("PARTIALLY_FULFILLED");
    expect(pendingQty({ requestedQty: 5, deliveredQty: 3 })).toBe(2);
    expect(pendingQty({ requestedQty: 5, deliveredQty: 9 })).toBe(0);
  });

  test("delivering more than pending is 422", () => {
    expect(() => assertDeliverable(2, 2)).not.toThrow();
    expect(() => assertDeliverable(2, 3)).toThrow(expect.objectContaining({ status: 422, code: "HOTEL_SUPPLY_DELIVERED_EXCEEDS" }));
  });

  test("confirm needs FULFILLED or PARTIALLY_FULFILLED and nothing in transit", () => {
    expect(() => assertCanConfirm("FULFILLED", 0)).not.toThrow();
    expect(() => assertCanConfirm("SUBMITTED", 0)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => assertCanConfirm("FULFILLED", 1)).toThrow(expect.objectContaining({ code: "HOTEL_SUPPLY_REQUEST_PENDING_RECEIPT" }));
  });

  test("zone subtree includes descendants", () => {
    const zones = [{ id: "hotel", parentId: null }, { id: "floor1", parentId: "hotel" }, { id: "room-area", parentId: "floor1" }, { id: "other", parentId: null }];
    expect([...zoneSubtree(zones, "hotel")].sort()).toEqual(["floor1", "hotel", "room-area"]);
    expect([...zoneSubtree(zones, "other")]).toEqual(["other"]);
  });
});

test.describe("Linen F2 D8: where the cart's dirty linen goes", () => {
  const zones = [{ id: "hotel", parentId: null }, { id: "floor1", parentId: "hotel" }, { id: "floor2", parentId: "hotel" }];

  test("uses the ZONE warehouse of the cart zone, climbing the tree", () => {
    const zoneWarehouses = [{ id: "wh-hotel", zoneId: "hotel" }];
    expect(resolveDirtyWarehouse({ cartZoneId: "floor1", roomZoneId: "floor2", zones, zoneWarehouses })).toBe("wh-hotel");
  });

  test("cart zone wins over the room zone", () => {
    const zoneWarehouses = [{ id: "wh-1", zoneId: "floor1" }, { id: "wh-2", zoneId: "floor2" }];
    expect(resolveDirtyWarehouse({ cartZoneId: "floor1", roomZoneId: "floor2", zones, zoneWarehouses })).toBe("wh-1");
  });

  test("falls back to the room zone when the cart has none", () => {
    const zoneWarehouses = [{ id: "wh-2", zoneId: "floor2" }];
    expect(resolveDirtyWarehouse({ cartZoneId: null, roomZoneId: "floor2", zones, zoneWarehouses })).toBe("wh-2");
  });

  test("no ZONE warehouse means null (falls back to laundry)", () => {
    expect(resolveDirtyWarehouse({ cartZoneId: "floor1", roomZoneId: "floor1", zones, zoneWarehouses: [] })).toBeNull();
  });
});

test.describe("Linen F2 day range", () => {
  test("covers one local day", () => {
    const { from, to } = dayRange("2026-11-08");
    expect(from.getDate()).toBe(8);
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(23 * 3600 * 1000);
    expect(to.getDate()).toBe(9);
  });

  test("rejects malformed dates", () => {
    expect(() => dayRange("08/11/2026")).toThrow(expect.objectContaining({ status: 400 }));
  });
});
