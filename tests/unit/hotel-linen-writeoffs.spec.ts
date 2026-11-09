import { test, expect } from "@playwright/test";
import {
  assertNotRequester,
  assertPhotos,
  assertReviewedOrOverride,
  buildWeeklyMatrix,
  groupByReason,
  imageMimeOf,
  reasonRequiresHold,
  sumGrades,
} from "../../src/modules/hotel-store/linen/services/writeoff-rules";
import { HotelWriteoffService } from "../../src/modules/hotel-store/linen/services/writeoff.service";
import { HotelStocktakeService } from "../../src/modules/hotel-store/services/stocktake.service";

test.describe("Linen F3 write-off rules", () => {
  test("groups the lines by reason: one write-off per reason", () => {
    const groups = groupByReason([
      { productId: "a", quantity: 1, reasonCode: "R" as const },
      { productId: "b", quantity: 2, reasonCode: "M" as const },
      { productId: "c", quantity: 3, reasonCode: "R" as const },
    ]);
    expect([...groups.keys()]).toEqual(["R", "M"]);
    expect(groups.get("R")).toHaveLength(2);
  });

  test("photos are required unless every reason is F", () => {
    expect(() => assertPhotos(["R"], 0)).toThrow();
    expect(() => assertPhotos(["F", "D"], 0)).toThrow();
    expect(() => assertPhotos(["F"], 0)).not.toThrow();
    expect(() => assertPhotos(["R"], 1)).not.toThrow();
  });

  test("the requester never authorizes", () => {
    expect(() => assertNotRequester("ana", "ana")).toThrow(expect.objectContaining({ code: "HOTEL_WRITEOFF_SELF_APPROVAL", status: 409 }));
    expect(() => assertNotRequester("ana", "luis")).not.toThrow();
  });

  test("approving without review needs the override and is flagged", () => {
    expect(assertReviewedOrOverride(true, false)).toEqual({ reviewSkipped: false });
    expect(() => assertReviewedOrOverride(false, false)).toThrow(expect.objectContaining({ code: "HOTEL_WRITEOFF_NOT_REVIEWED" }));
    expect(assertReviewedOrOverride(false, true)).toEqual({ reviewSkipped: true });
  });

  test("weekly matrix: product x reason with totals and cost", () => {
    const m = buildWeeklyMatrix([
      { productId: "s1", code: "S1", name: "Sheet", reasonCode: "R", quantity: 3, unitCost: 100 },
      { productId: "s1", code: "S1", name: "Sheet", reasonCode: "D", quantity: 2, unitCost: 100 },
      { productId: "t1", code: "T1", name: "Towel", reasonCode: "F", quantity: 5, unitCost: 20 },
    ]);
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]).toMatchObject({ name: "Sheet", byReason: { R: 3, M: 0, D: 2, Q: 0, F: 0 }, total: 5, cost: 500 });
    expect(m.totals).toMatchObject({ total: 10, cost: 600, byReason: { R: 3, D: 2, F: 5 } });
  });

  test("grades add up, and none means a plain count", () => {
    expect(sumGrades({ gradeA: 10, gradeB: 5, gradeC: 2, gradeD: 1, gradeE: 3 })).toBe(21);
    expect(sumGrades({ gradeA: 4 })).toBe(4);
    expect(sumGrades({})).toBeNull();
    expect(() => sumGrades({ gradeA: -1 })).toThrow();
  });
});

const makeWriteoffService = (opts: { reviewed: boolean; requester: string }) => {
  const moved: unknown[] = [];
  const signed: string[] = [];
  const tx = {
    hotelMovement: {
      findFirst: async () => ({
        id: "w1", folio: "MOV-H-0001", status: "PENDING_APPROVAL", createdById: opts.requester, fromWarehouseId: "wh",
        lines: [{ productId: "p", lotId: "l", fromLocationId: "q", quantity: 4 }],
      }),
      update: async () => ({}),
    },
    hotelSignature: { findFirst: async () => (opts.reviewed ? { id: "s" } : null) },
  };
  const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx), hotelMovement: { findFirst: async () => null } };
  const movements = { move: async (...args: unknown[]) => { moved.push(args); } };
  const signatures = { sign: async (_d: string, _i: string, role: string) => { signed.push(role); }, list: async () => [] };
  const svc = new HotelWriteoffService(db as never, movements as never, signatures as never);
  // get() lee otra forma de datos; se sustituye para aislar la autorización.
  (svc as unknown as { get: () => Promise<object> }).get = async () => ({});
  return { svc, moved, signed };
};

test.describe("Linen F3 write-off authorization", () => {
  test("self-authorization is a 409 and moves no stock", async () => {
    const { svc, moved } = makeWriteoffService({ reviewed: true, requester: "ana" });
    await expect(svc.approve("w1", "ana", "ana", "SESSION", "DISPOSAL", true)).rejects.toMatchObject({ code: "HOTEL_WRITEOFF_SELF_APPROVAL", status: 409 });
    expect(moved).toHaveLength(0);
  });

  test("an unreviewed write-off needs the override", async () => {
    const { svc, moved } = makeWriteoffService({ reviewed: false, requester: "ana" });
    await expect(svc.approve("w1", "luis", "luis", "SESSION", "DISPOSAL", false)).rejects.toMatchObject({ code: "HOTEL_WRITEOFF_NOT_REVIEWED" });
    expect(moved).toHaveLength(0);
  });

  test("approval takes the reserved lot out of the location and signs AUTHORIZES", async () => {
    const { svc, moved, signed } = makeWriteoffService({ reviewed: true, requester: "ana" });
    await svc.approve("w1", "luis", "luis", "SESSION", "SECOND_LIFE", false);
    expect(moved).toEqual([[expect.anything(), "p", "wh", "q", "l", -4]]);
    expect(signed).toEqual(["AUTHORIZES"]);
  });
});

test.describe("Linen F3 count A-E", () => {
  test("capture stores grades and counts their sum", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const tx = {
      hotelStocktake: { findUnique: async () => ({ id: "t1", warehouseId: "wh", status: "COUNTING" }) },
      hotelLocation: { findFirst: async () => ({ id: "loc" }) },
      hotelProduct: { findUnique: async () => ({ id: "p", kind: "LINEN" }) },
      hotelStocktakeLine: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => { saved.push(data); return data; },
      },
    };
    const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
    const svc = new HotelStocktakeService(db as never, {} as never);
    await svc.capture("t1", [{ productId: "p", locationId: "loc", gradeA: 10, gradeB: 5, gradeE: 2 }], "u");
    expect(saved[0]).toMatchObject({ countedQty: 17, gradeA: 10, gradeB: 5, gradeC: 0, gradeD: 0, gradeE: 2 });
  });

  test("approval raises a pending write-off for grade E, requested by who closed the count", async () => {
    const posted: Array<{ type: string; forcePending?: boolean; reasonId?: string; fromWarehouseId?: string; lines: Array<{ productId: string; quantity: number; fromLocationId?: string | null }> }> = [];
    const signatures: Array<{ userId: string; role: string }> = [];
    const stocktake = { id: "t1", folio: "TI-H-0001", warehouseId: "wh", status: "PENDING_APPROVAL", closedById: "marco", snapshotAt: new Date("2026-10-26T20:00:00Z") };
    const tx = {
      hotelStocktake: { findUnique: async () => stocktake, update: async ({ data }: { data: object }) => ({ ...stocktake, ...data }) },
      hotelStocktakeLine: {
        findMany: async () => [{ productId: "sheet", locationId: "shelf", systemQty: 20, countedQty: 20, gradeE: 3 }],
      },
      hotelMovement: { findMany: async () => [], update: async () => ({}) },
      hotelProduct: { findMany: async () => [{ id: "sheet", kind: "LINEN" }] },
      hotelReason: { findFirst: async () => ({ id: "reason-d" }) },
      hotelLocation: { findMany: async () => [{ id: "quarantine", code: "QUARANTINE" }], findFirst: async () => ({ id: "quarantine" }) },
      hotelWarehouse: {
        findUnique: async () => ({ id: "wh", kind: "ZONE", active: true }),
        findFirst: async () => ({ id: "lav", kind: "LAUNDRY", active: true }),
      },
      hotelSignature: { create: async ({ data }: { data: { userId: string; role: string } }) => { signatures.push(data); } },
    };
    const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
    const movements = {
      applyInTransaction: async (_t: unknown, input: (typeof posted)[number]) => {
        posted.push(input);
        // La retención devuelve sus lotes; la baja pendiente se arma desde ellos.
        if (input.type === "TRANSFER") return { id: "h1", lines: [{ productId: "sheet", quantity: 3, lotId: "lot-1" }] };
        return { id: "w1", lines: [] };
      },
    };
    const svc = new HotelStocktakeService(db as never, movements as never);
    await svc.approve("t1", "laura", true);
    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({ type: "TRANSFER", fromWarehouseId: "wh", warehouseId: "lav", sourceDocType: "HOTEL_WRITEOFF_HOLD" });
    expect(posted[1]).toMatchObject({ type: "WRITE_OFF", forcePending: true, reasonId: "reason-d", fromWarehouseId: "lav", originWarehouseId: "wh" });
    expect(posted[1].lines).toEqual([expect.objectContaining({ productId: "sheet", quantity: 3, fromLocationId: "quarantine", lotId: "lot-1" })]);
    expect(signatures).toEqual([{ docType: "HOTEL_WRITEOFF", docId: "w1", role: "DELIVERS", userId: "marco", method: "SESSION" }]);
  });
});

test.describe("Linen integration D9 / supply close / dirty formula", () => {
  test("a write-off with linen is always pending approval", async () => {
    const { writeoffForcesPending } = await import("../../src/modules/hotel-store/linen/services/writeoff-rules");
    expect(writeoffForcesPending("WRITE_OFF", ["LINEN"])).toBe(true);
    expect(writeoffForcesPending("WRITE_OFF", ["CONSUMABLE", "LINEN"])).toBe(true);
    expect(writeoffForcesPending("WRITE_OFF", ["CONSUMABLE"])).toBe(false);
    expect(writeoffForcesPending("ADJUST_OUT", ["LINEN"])).toBe(false);
  });

  test("movement service: linen WRITE_OFF is PENDING_APPROVAL and creator cannot approve", async () => {
    const { HotelMovementService } = await import("../../src/modules/hotel-store/services/movement.service");
    const created: Array<{ status: string }> = [];
    const movement = { id: "m1", type: "WRITE_OFF", status: "PENDING_APPROVAL", createdById: "ana", fromWarehouseId: "w", warehouseId: null, lines: [{ productId: "p", quantity: 1, lotId: "l", fromLocationId: "loc" }] };
    const tx = {
      hotelProduct: { findUnique: async () => ({ id: "p", active: true, kind: "LINEN", lastCost: null, unit: { whole: true } }), findMany: async () => [{ kind: "LINEN" }] },
      hotelMovement: { findUnique: async () => movement, create: async (a: { data: { status: string } }) => { created.push(a.data); return { id: "m1", lines: [] }; }, count: async () => 0, findFirst: async () => null },
    };
    const service = new HotelMovementService({ $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never) as unknown as {
      approve: (id: string, actor: string) => Promise<unknown>;
    };
    await expect(service.approve("m1", "ana")).rejects.toMatchObject({ code: "HOTEL_WRITEOFF_SELF_APPROVAL" });
  });

  test("supply request: partially fulfilled can be closed unless goods are in transit", async () => {
    const { assertCanConfirm, closeOutcome } = await import("../../src/modules/hotel-store/linen/services/supply-request-rules");
    expect(() => assertCanConfirm("PARTIALLY_FULFILLED", 0)).not.toThrow();
    expect(() => assertCanConfirm("PARTIALLY_FULFILLED", 1)).toThrow(expect.objectContaining({ code: "HOTEL_SUPPLY_REQUEST_PENDING_RECEIPT" }));
    expect(() => assertCanConfirm("SUBMITTED", 0)).toThrow(expect.objectContaining({ code: "HOTEL_SUPPLY_REQUEST_INVALID_STATE" }));
    expect(closeOutcome([{ code: "S1", requestedQty: 10, deliveredQty: 6 }, { code: "T1", requestedQty: 2, deliveredQty: 2 }])).toEqual({
      status: "RECEIVED",
      closedWithPending: true,
      pending: [{ code: "S1", quantity: 4 }],
    });
    expect(closeOutcome([{ code: "S1", requestedQty: 2, deliveredQty: 2 }]).closedWithPending).toBe(false);
  });

  test("dirty receipt: delivered-to-floor discounts earlier receipts of the day", async () => {
    const { remainingDelivered, computeShortage } = await import("../../src/modules/hotel-store/linen/services/dirty-receipt-rules");
    // 100 por pedido + 20 adicionales = 120; carro 1 recibe 50 sucio y 10 en uso.
    expect(remainingDelivered(120, 0, 0)).toBe(120);
    expect(remainingDelivered(120, 50, 10)).toBe(60);
    expect(computeShortage(remainingDelivered(120, 50, 10), 60, 0)).toBe(0);
    expect(remainingDelivered(120, 130, 0)).toBe(0);
  });
});

test.describe("Linen v2: cuarentena y evidencia", () => {
  test("los motivos físicos retienen la pieza y el faltante no", () => {
    expect(reasonRequiresHold("R")).toBe(true);
    expect(reasonRequiresHold("M")).toBe(true);
    expect(reasonRequiresHold("D")).toBe(true);
    expect(reasonRequiresHold("Q")).toBe(true);
    expect(reasonRequiresHold("F")).toBe(false);
  });

  test("solo se aceptan imágenes reales por su firma", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8, 1)]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12, 1)]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 1), Buffer.from("WEBP"), Buffer.alloc(4, 1)]);
    expect(imageMimeOf(png)).toBe("image/png");
    expect(imageMimeOf(jpg)).toBe("image/jpeg");
    expect(imageMimeOf(webp)).toBe("image/webp");
    expect(imageMimeOf(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(imageMimeOf(Buffer.alloc(4))).toBeNull();
  });
});
