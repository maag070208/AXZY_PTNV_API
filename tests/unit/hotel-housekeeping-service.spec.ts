import { test, expect } from "@playwright/test";
import { HotelHousekeepingService } from "../../src/modules/hotel-store/services/housekeeping.service";

const DAY = 24 * 60 * 60 * 1000;

const kitLines = [
  { productId: "soap", quantity: 1, frequency: "EVERY_CLEANING", everyNDays: null },
  { productId: "sheet", quantity: 2, frequency: "CHECKOUT_ONLY", everyNDays: null },
  { productId: "towel", quantity: 2, frequency: "EVERY_N_DAYS", everyNDays: 3 },
];

/** Transaction client with one room type, its kit, and an optional finished history. */
const makeTx = (opts: { kitActive?: boolean; hasKit?: boolean; finishedTowelDaysAgo?: number } = {}) => {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const tx = {
    hotelHousekeepingTask: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ data });
        return { id: "task-1", ...data };
      },
    },
    hotelRoomType: {
      findUnique: async () =>
        opts.hasKit === false
          ? { kitId: null, kit: null }
          : {
              kitId: "kit-1",
              kit: { id: "kit-1", active: opts.kitActive ?? true, lines: kitLines.map((l) => ({ ...l, quantity: l.quantity })) },
            },
    },
    hotelTaskLine: {
      findMany: async () =>
        opts.finishedTowelDaysAgo === undefined
          ? []
          : [{ productId: "towel", task: { finishedAt: new Date(Date.now() - opts.finishedTowelDaysAgo * DAY) } }],
    },
  };
  return { tx, created };
};

const makeService = () =>
  new HotelHousekeepingService(
    {} as never,
    {} as never,
    async () => false,
    undefined
  );

const room = { id: "room-101", typeId: "type-std", zoneId: "north" };

test.describe("M5 task creation", () => {
  test("a checkout freezes the kit lines that apply to it", async () => {
    const { tx, created } = makeTx({ finishedTowelDaysAgo: 1 });
    await makeService().openForRoom(tx as never, room, "CHECKOUT");
    const lines = (created[0].data.lines as { create: Array<{ productId: string }> }).create.map((l) => l.productId);
    // soap (every cleaning), sheet (checkout only) and towel (every 3 days, always at checkout).
    expect(lines).toEqual(["soap", "sheet", "towel"]);
    expect(created[0].data).toMatchObject({ cleaningType: "CHECKOUT", kitAlert: false, kitId: "kit-1" });
  });

  test("a stay skips checkout-only lines and every-N-day lines still inside their window", async () => {
    const { tx, created } = makeTx({ finishedTowelDaysAgo: 2 });
    await makeService().openForRoom(tx as never, room, "STAY");
    const lines = (created[0].data.lines as { create: Array<{ productId: string }> }).create.map((l) => l.productId);
    expect(lines).toEqual(["soap"]);
  });

  test("a checkout whose type has no active kit opens with the alert and no kit lines (P1)", async () => {
    const { tx, created } = makeTx({ kitActive: false });
    await makeService().openForRoom(tx as never, room, "CHECKOUT");
    expect(created[0].data).toMatchObject({ kitAlert: true, kitId: null });
    expect((created[0].data.lines as { create: unknown[] }).create).toEqual([]);
  });

  test("a turndown consumes nothing", async () => {
    const { tx, created } = makeTx();
    await makeService().openForRoom(tx as never, room, "TURNDOWN");
    expect((created[0].data.lines as { create: unknown[] }).create).toEqual([]);
    expect(created[0].data).toMatchObject({ kitAlert: false });
  });
});
