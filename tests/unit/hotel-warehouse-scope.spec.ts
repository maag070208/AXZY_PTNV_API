import { test, expect } from "@playwright/test";
import { HotelWarehouseService } from "../../src/modules/hotel-store/services/warehouse.service";
import { HotelRoomsService, type Caller } from "../../src/modules/hotel-store/services/rooms.service";

/** Zone tree: North Building → Floor 1 → Wing A; South Building → Floor 1. */
const zones = [
  { id: "norte", parentId: null, kind: "BUILDING" },
  { id: "norte-p1", parentId: "norte", kind: "FLOOR" },
  { id: "norte-ala-a", parentId: "norte-p1", kind: "AREA" },
  { id: "sur", parentId: null, kind: "BUILDING" },
  { id: "sur-p1", parentId: "sur", kind: "FLOOR" },
];
const warehouses = [
  { id: "w-norte", zoneId: "norte-ala-a", ownerId: null },
  { id: "w-sur", zoneId: "sur-p1", ownerId: null },
  { id: "w-cart-elena", zoneId: null, ownerId: "elena" },
  { id: "w-cart-rosa", zoneId: null, ownerId: "rosa" },
];

const makeDb = (supervised: string[] = []) => {
  const db = {
    hotelZone: { findMany: async () => zones },
    hotelZoneSupervisor: { findMany: async () => supervised.map((zoneId) => ({ zoneId })) },
    hotelWarehouse: {
      findMany: async ({ where = {} }: { where?: { zoneId?: { in: string[] }; ownerId?: string } } = {}) =>
        warehouses.filter(
          (w) =>
            (!where.zoneId || where.zoneId.in.includes(w.zoneId ?? "")) &&
            (!where.ownerId || w.ownerId === where.ownerId)
        ),
    },
  };
  return db;
};

const caller = (id: string, scope: "ALL" | "AREA" | "OWN" | "NONE"): Caller => ({
  id,
  role: "HOTEL_STORE",
  exceptions: [{ permission: "hotel_store.view", scope, expiresAt: null }],
});

const serviceFor = (supervised: string[] = []) => {
  const db = makeDb(supervised);
  return new HotelWarehouseService(db as never, new HotelRoomsService(db as never));
};

test.describe("M3 warehouse scope", () => {
  test("ALL sees every warehouse (null = no filter)", async () => {
    expect(await serviceFor().visibleWarehouseIds(caller("u", "ALL"), "hotel_store.view")).toBeNull();
  });

  test("AREA sees the warehouses of its zones and their descendants, nothing else", async () => {
    const visible = await serviceFor(["norte"]).visibleWarehouseIds(caller("u", "AREA"), "hotel_store.view");
    expect(visible).toEqual(["w-norte"]);
  });

  test("AREA without zones sees nothing", async () => {
    expect(await serviceFor([]).visibleWarehouseIds(caller("u", "AREA"), "hotel_store.view")).toEqual([]);
  });

  test("OWN sees only the cart it owns", async () => {
    expect(await serviceFor().visibleWarehouseIds(caller("elena", "OWN"), "hotel_store.view")).toEqual(["w-cart-elena"]);
  });

  test("NONE sees nothing", async () => {
    expect(await serviceFor().visibleWarehouseIds(caller("u", "NONE"), "hotel_store.view")).toEqual([]);
  });

  test("touching a warehouse outside the scope is refused with 403", async () => {
    const svc = serviceFor(["norte"]);
    await expect(svc.assertWarehousesVisible(caller("u", "AREA"), ["w-sur"], "hotel_store.view")).rejects.toMatchObject({
      status: 403,
      code: "HOTEL_ACCESS_DENIED",
    });
    await expect(svc.assertWarehousesVisible(caller("u", "AREA"), ["w-norte", null], "hotel_store.view")).resolves.toBeUndefined();
  });
});
