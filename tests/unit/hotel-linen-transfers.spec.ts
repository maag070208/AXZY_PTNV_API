import { test, expect } from "@playwright/test";
import { allocateFifo, lotCode } from "../../src/modules/hotel-store/services/lot-rules";
import { diffStock, expectedStock, type LedgerMovement } from "../../src/modules/hotel-store/services/kardex-rules";
import {
  assertCanCancelTransfer,
  assertDifferentUsers,
  assertReceivedQuantity,
  receptionStatus,
  stockLight,
} from "../../src/modules/hotel-store/linen/services/transfer-rules";
import { HotelLinenTransferService } from "../../src/modules/hotel-store/linen/services/transfer.service";

const day = (d: number) => new Date(Date.UTC(2026, 0, d));

test.describe("Linen F1 lots: FIFO allocation", () => {
  test("takes the oldest lot first and splits across lots", () => {
    const { allocations, remaining } = allocateFifo(
      [
        { lotId: "new", receivedAt: day(10), available: 50 },
        { lotId: "old", receivedAt: day(1), available: 8 },
        { lotId: "mid", receivedAt: day(5), available: 20 },
      ],
      30
    );
    expect(allocations).toEqual([
      { lotId: "old", quantity: 8 },
      { lotId: "mid", quantity: 20 },
      { lotId: "new", quantity: 2 },
    ]);
    expect(remaining).toBe(0);
  });

  test("one lot is enough when it covers the quantity", () => {
    const { allocations } = allocateFifo([{ lotId: "a", receivedAt: day(1), available: 10 }], 4);
    expect(allocations).toEqual([{ lotId: "a", quantity: 4 }]);
  });

  test("reports what is not covered and ignores empty lots", () => {
    const { allocations, remaining } = allocateFifo(
      [{ lotId: "empty", receivedAt: day(1), available: 0 }, { lotId: "a", receivedAt: day(2), available: 3 }],
      5
    );
    expect(allocations).toEqual([{ lotId: "a", quantity: 3 }]);
    expect(remaining).toBe(2);
  });

  test("ties on date are broken by code, and the input is not mutated", () => {
    const input = [
      { lotId: "b", code: "20260101-2", receivedAt: day(1), available: 5 },
      { lotId: "a", code: "20260101-1", receivedAt: day(1), available: 5 },
    ];
    expect(allocateFifo(input, 6).allocations.map((a) => a.lotId)).toEqual(["a", "b"]);
    expect(input[0].lotId).toBe("b");
  });

  test("lot code is AAAAMMDD-n", () => {
    expect(lotCode(new Date(2026, 10, 8), 3)).toBe("20261108-3");
  });
});

test.describe("Linen F1 transfers: rules", () => {
  test("reception with every line matching is ACTIVE; any difference is RECEIVED_WITH_DIFFERENCE", () => {
    expect(receptionStatus([{ quantity: 10, receivedQuantity: 10 }, { quantity: 5, receivedQuantity: 5 }])).toBe("ACTIVE");
    expect(receptionStatus([{ quantity: 10, receivedQuantity: 10 }, { quantity: 5, receivedQuantity: 4 }])).toBe("RECEIVED_WITH_DIFFERENCE");
    expect(receptionStatus([{ quantity: 5, receivedQuantity: 0 }])).toBe("RECEIVED_WITH_DIFFERENCE");
  });

  test("receiving more than sent is 422; zero and exact are fine", () => {
    expect(() => assertReceivedQuantity(10, 11)).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => assertReceivedQuantity(10, 0)).not.toThrow();
    expect(() => assertReceivedQuantity(10, 10)).not.toThrow();
  });

  test("separation of duties: the receiver cannot be the creator or the deliverer", () => {
    expect(() => assertDifferentUsers(["ana", "luis"], "ana")).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => assertDifferentUsers(["ana", "luis"], "luis")).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => assertDifferentUsers(["ana", undefined], "marco")).not.toThrow();
  });

  test("cancel: only in transit, and only the sender or an approver", () => {
    expect(() => assertCanCancelTransfer("ACTIVE", "ana", ["ana"], true)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => assertCanCancelTransfer("IN_TRANSIT", "marco", ["ana"], false)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertCanCancelTransfer("IN_TRANSIT", "ana", ["ana"], false)).not.toThrow();
    expect(() => assertCanCancelTransfer("IN_TRANSIT", "marco", ["ana"], true)).not.toThrow();
  });

  test("par traffic light: green >= 100%, yellow >= 90%, red below, none without par", () => {
    expect(stockLight(100, 100)).toBe("green");
    expect(stockLight(90, 100)).toBe("yellow");
    expect(stockLight(89, 100)).toBe("red");
    expect(stockLight(5, 0)).toBe("none");
  });
});

test.describe("Linen F1 reconcile with transit", () => {
  const inbound: LedgerMovement = {
    type: "INBOUND", status: "ACTIVE", fromWarehouseId: null, warehouseId: "new",
    lines: [{ productId: "sheet", lotId: "L1", quantity: 100, fromLocationId: null, toLocationId: "new-general" }],
  };
  const transfer = (status: string, received: number | null): LedgerMovement => ({
    type: "TRANSFER", status, fromWarehouseId: "new", warehouseId: "laundry",
    lines: [{ productId: "sheet", lotId: "L1", quantity: 30, receivedQuantity: received, fromLocationId: "new-general", toLocationId: "laundry-dirty" }],
  });

  test("in transit only takes from the origin", () => {
    const expected = expectedStock([inbound, transfer("IN_TRANSIT", null)]);
    const actual = [{ productId: "sheet", warehouseId: "new", locationId: "new-general", lotId: "L1", quantity: 70 }];
    expect(diffStock(actual, expected)).toEqual([]);
  });

  test("received adds only what was counted; the shortfall does not return to stock", () => {
    const expected = expectedStock([inbound, transfer("RECEIVED_WITH_DIFFERENCE", 27)]);
    const actual = [
      { productId: "sheet", warehouseId: "new", locationId: "new-general", lotId: "L1", quantity: 70 },
      { productId: "sheet", warehouseId: "laundry", locationId: "laundry-dirty", lotId: "L1", quantity: 27 },
    ];
    expect(diffStock(actual, expected)).toEqual([]);
    const wrong = [actual[0], { ...actual[1], quantity: 30 }];
    expect(diffStock(wrong, expected)).toEqual([expect.objectContaining({ warehouseId: "laundry", difference: 3 })]);
  });

  test("fully received (ACTIVE) adds the full quantity; the ledger is per lot", () => {
    const expected = expectedStock([inbound, transfer("ACTIVE", 30)]);
    const actual = [
      { productId: "sheet", warehouseId: "new", locationId: "new-general", lotId: "L1", quantity: 70 },
      { productId: "sheet", warehouseId: "laundry", locationId: "laundry-dirty", lotId: "L1", quantity: 30 },
    ];
    expect(diffStock(actual, expected)).toEqual([]);
    expect(diffStock([{ ...actual[0], lotId: "L2" }, actual[1]], expected).length).toBe(2);
  });
});

test.describe("Linen F1 receive (service)", () => {
  const movement = {
    id: "t1", folio: "MOV-H-0001", status: "IN_TRANSIT", sourceDocType: "HOTEL_TRANSFER", createdById: "ana",
    warehouseId: "laundry", fromWarehouseId: "new",
    lines: [
      { id: "l1", productId: "sheet", lotId: "L1", quantity: 10, toLocationId: "laundry-dirty", fromLocationId: "new-general" },
      { id: "l2", productId: "towel", lotId: "L2", quantity: 5, toLocationId: "laundry-dirty", fromLocationId: "new-general" },
    ],
  };
  const make = () => {
    const calls = { moves: [] as unknown[], updates: [] as Array<Record<string, unknown>>, signed: [] as string[] };
    const tx = {
      hotelMovement: {
        findUnique: async () => movement,
        update: async ({ data }: { data: Record<string, unknown> }) => { calls.updates.push(data); return data; },
      },
      hotelSignature: { findFirst: async () => ({ userId: "luis" }) },
      hotelProduct: { findMany: async () => [{ id: "sheet", unit: { whole: true } }, { id: "towel", unit: { whole: true } }] },
      hotelMovementLine: { update: async () => ({}) },
    };
    const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
    const movements = { move: async (...args: unknown[]) => { calls.moves.push(args.slice(1)); } };
    const signatures = { sign: async (_d: string, _i: string, role: string, user: string) => { calls.signed.push(`${role}:${user}`); }, resolveCosignUser: async () => "carla" };
    const svc = new HotelLinenTransferService(db as never, movements as never, signatures as never);
    (svc as unknown as { get: () => Promise<object> }).get = async () => ({});
    return { svc, calls };
  };
  const lines = (a: number, b: number) => [{ lineId: "l1", receivedQuantity: a }, { lineId: "l2", receivedQuantity: b }];

  test("the sender cannot receive (409), nor the one who signed the delivery", async () => {
    const { svc } = make();
    await expect(svc.receive("t1", { lines: lines(10, 5) }, "ana")).rejects.toMatchObject({ status: 409 });
    await expect(svc.receive("t1", { lines: lines(10, 5) }, "luis")).rejects.toMatchObject({ status: 409 });
  });

  test("a matching count enters the same lots and leaves the transfer ACTIVE; a cosign receiver signs RECEIVES", async () => {
    const { svc, calls } = make();
    await svc.receive("t1", { lines: lines(10, 5), cosignToken: "tok" }, "ana");
    expect(calls.updates[0]).toMatchObject({ status: "ACTIVE", receivedById: "carla" });
    expect(calls.moves).toEqual([["sheet", "laundry", "laundry-dirty", "L1", 10], ["towel", "laundry", "laundry-dirty", "L2", 5]]);
    expect(calls.signed).toEqual(["RECEIVES:carla"]);
  });

  test("a short count only enters what was counted and flags the difference", async () => {
    const { svc, calls } = make();
    await svc.receive("t1", { lines: lines(8, 0) }, "marco");
    expect(calls.updates[0]).toMatchObject({ status: "RECEIVED_WITH_DIFFERENCE" });
    expect(calls.moves).toEqual([["sheet", "laundry", "laundry-dirty", "L1", 8]]);
  });

  test("more than sent is 422 and a missing line is 422", async () => {
    const { svc } = make();
    await expect(svc.receive("t1", { lines: lines(11, 5) }, "marco")).rejects.toMatchObject({ status: 422 });
    await expect(svc.receive("t1", { lines: [{ lineId: "l1", receivedQuantity: 10 }] }, "marco")).rejects.toMatchObject({ status: 422 });
  });
});
