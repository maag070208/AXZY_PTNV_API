import { test, expect } from "@playwright/test";
import { HotelStocktakeService } from "../../src/modules/hotel-store/services/stocktake.service";

/** Fake database for one count: photo taken, two lines counted, no movements since. */
const makeDb = (overrides: { open?: boolean; closedBy?: string } = {}) => {
  const adjustments: Array<{ type: string; lines: unknown[] }> = [];
  const stocktake = {
    id: "t1",
    folio: "TI-H-0001",
    warehouseId: "central",
    status: "PENDING_APPROVAL",
    closedById: overrides.closedBy ?? "marco",
    snapshotAt: new Date("2026-10-26T20:00:00Z"),
  };
  const tx: Record<string, unknown> = {
    hotelStocktake: {
      findUnique: async () => stocktake,
      update: async ({ data }: { data: object }) => ({ ...stocktake, ...data }),
      findFirst: async () => (overrides.open ? { id: "other" } : null),
      count: async () => 0,
      create: async ({ data }: { data: object }) => ({ id: "t2", ...data }),
    },
    hotelStocktakeLine: {
      findMany: async () => [
        { productId: "soap", locationId: "central-general", systemQty: 40, countedQty: 38 },
        { productId: "towel", locationId: "central-general", systemQty: 0, countedQty: 12 },
      ],
    },
    hotelMovement: { findMany: async () => [] },
    hotelReason: { findFirst: async () => ({ id: "count-reason" }) },
  };
  const db = {
    ...tx,
    hotelWarehouse: { findUnique: async () => ({ id: "central", active: true }) },
    hotelStocktake: { ...(tx.hotelStocktake as object), findFirst: async () => (overrides.open ? { id: "other" } : null), count: async () => 0 },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  const movements = {
    applyInTransaction: async (_tx: unknown, input: { type: string; lines: unknown[] }) => {
      adjustments.push({ type: input.type, lines: input.lines });
      return { id: "m" };
    },
  };
  return { db, movements, adjustments };
};

const makeService = (overrides: Parameters<typeof makeDb>[0] = {}) => {
  const { db, movements, adjustments } = makeDb(overrides);
  return { svc: new HotelStocktakeService(db as never, movements as never), adjustments };
};

test.describe("M4 stocktake approval", () => {
  test("approval posts one inbound and one outbound adjustment with the counted differences", async () => {
    const { svc, adjustments } = makeService();
    await svc.approve("t1", "laura", false);
    expect(adjustments.map((a) => a.type)).toEqual(["ADJUST_IN", "ADJUST_OUT"]);
    expect(adjustments[0].lines).toEqual([
      expect.objectContaining({ productId: "towel", quantity: 12, toLocationId: "central-general" }),
    ]);
    expect(adjustments[1].lines).toEqual([
      expect.objectContaining({ productId: "soap", quantity: 2, fromLocationId: "central-general" }),
    ]);
  });

  test("the person who closed the count cannot approve it without the ALL scope", async () => {
    const { svc, adjustments } = makeService({ closedBy: "marco" });
    await expect(svc.approve("t1", "marco", false)).rejects.toMatchObject({ code: "HOTEL_SELF_APPROVAL", status: 403 });
    expect(adjustments).toHaveLength(0);
  });

  test("with the ALL scope the same person may approve, and it is recorded", async () => {
    const { svc, adjustments } = makeService({ closedBy: "marco" });
    const updated = await svc.approve("t1", "marco", true);
    expect(adjustments).toHaveLength(2);
    expect(updated).toMatchObject({ status: "APPLIED", approvedById: "marco" });
  });
});

test.describe("M4 stocktake creation", () => {
  test("a warehouse with an open count cannot open another one", async () => {
    const { svc } = makeService({ open: true });
    await expect(svc.create({ warehouseId: "central" }, "marco")).rejects.toMatchObject({ code: "HOTEL_STOCKTAKE_OPEN_EXISTS" });
  });

  test("a new count gets its folio and starts as a blind draft", async () => {
    const { svc } = makeService();
    const created = await svc.create({ warehouseId: "central" }, "marco");
    expect(created).toMatchObject({ folio: "TI-H-0001", blind: true, createdById: "marco" });
  });
});
