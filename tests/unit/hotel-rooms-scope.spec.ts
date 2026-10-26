import { test, expect } from "@playwright/test";
import { HotelRoomsService, type Caller } from "../../src/modules/hotel-store/services/rooms.service";

/**
 * M1-U03 (effective inspection) and M1-U05 (zone scope). Test tree:
 *   North Building (BUILDING, requires inspection)
 *     ├─ Piso 1 (FLOOR)
 *     │    └─ Ala A (AREA)
 *     └─ Piso 2 (FLOOR)
 *   Edificio Sur (BUILDING)
 *     └─ Piso 1 Sur (FLOOR)
 */
const zones = [
  { id: "norte", parentId: null, requiresInspection: true },
  { id: "norte-p1", parentId: "norte", requiresInspection: false },
  { id: "norte-ala-a", parentId: "norte-p1", requiresInspection: false },
  { id: "norte-p2", parentId: "norte", requiresInspection: false },
  { id: "sur", parentId: null, requiresInspection: false },
  { id: "sur-p1", parentId: "sur", requiresInspection: false },
];

const makeDb = (opts: { typeRequiresInspection?: boolean; supervised?: string[] } = {}) => ({
  hotelZone: { findMany: async () => zones },
  hotelZoneSupervisor: {
    findMany: async () => (opts.supervised ?? []).map((zoneId) => ({ zoneId })),
  },
  hotelRoomType: {
    findUnique: async () => ({ requiresInspection: opts.typeRequiresInspection ?? false }),
  },
});

const caller = (scope: "ALL" | "AREA" | "OWN" | "NONE"): Caller => ({
  id: "elena",
  role: "HOUSEKEEPING_SUPERVISOR",
  exceptions: [{ permission: "hotel_rooms.view", scope, expiresAt: null }],
});

test.describe("M1-U03 effective inspection", () => {
  test("el tipo la exige, o cualquier ancestro de la zona", async () => {
    const svc = new HotelRoomsService(makeDb() as never);
    // Wing A hangs off Floor 1 → North Building, which requires inspection.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "norte-ala-a" })).toBe(true);
    // Floor 2 also inherits from the building.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "norte-p2" })).toBe(true);
    // South Building does not require it.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "sur-p1" })).toBe(false);
  });

  test("a room type that requires inspection does so even if the zone does not", async () => {
    const svc = new HotelRoomsService(makeDb({ typeRequiresInspection: true }) as never);
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "sur-p1" })).toBe(true);
  });
});

test.describe("M1-U05 zone scope", () => {
  test("ALL sees everything (null = no filter)", async () => {
    const svc = new HotelRoomsService(makeDb() as never);
    expect(await svc.visibleZoneIds(caller("ALL"), "hotel_rooms.view")).toBeNull();
  });

  test("AREA sees its assigned zones and all their descendants, nothing outside", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: ["norte"] }) as never);
    const visible = await svc.visibleZoneIds(caller("AREA"), "hotel_rooms.view");
    expect([...(visible ?? [])].sort()).toEqual(["norte", "norte-ala-a", "norte-p1", "norte-p2"]);
  });

  test("AREA without assigned zones sees nothing (never everything)", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: [] }) as never);
    const visible = await svc.visibleZoneIds(caller("AREA"), "hotel_rooms.view");
    expect(visible?.size).toBe(0);
  });

  test("OWN grants no zones: the own scope does not apply to rooms", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: ["norte"] }) as never);
    const visible = await svc.visibleZoneIds(caller("OWN"), "hotel_rooms.view");
    expect(visible?.size).toBe(0);
  });
});
