import { test, expect } from "@playwright/test";
import { HotelRoomsService, type Caller } from "../../src/modules/hotel-store/services/rooms.service";

/**
 * M1-U03 (inspección efectiva) y M1-U05 (alcance por zona). Árbol de prueba:
 *   Edificio Norte (EDIFICIO, requiere inspección)
 *     ├─ Piso 1 (PISO)
 *     │    └─ Ala A (AREA)
 *     └─ Piso 2 (PISO)
 *   Edificio Sur (EDIFICIO)
 *     └─ Piso 1 Sur (PISO)
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

test.describe("M1-U03 inspección efectiva", () => {
  test("el tipo la exige, o cualquier ancestro de la zona", async () => {
    const svc = new HotelRoomsService(makeDb() as never);
    // Ala A cuelga de Piso 1 → Edificio Norte, que exige inspección.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "norte-ala-a" })).toBe(true);
    // Piso 2 también hereda del edificio.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "norte-p2" })).toBe(true);
    // Edificio Sur no exige.
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "sur-p1" })).toBe(false);
  });

  test("el tipo con inspección la exige aunque la zona no", async () => {
    const svc = new HotelRoomsService(makeDb({ typeRequiresInspection: true }) as never);
    expect(await svc.inspectionRequired({ typeId: "t", zoneId: "sur-p1" })).toBe(true);
  });
});

test.describe("M1-U05 alcance por zona", () => {
  test("ALL ve todo (null = sin filtro)", async () => {
    const svc = new HotelRoomsService(makeDb() as never);
    expect(await svc.visibleZoneIds(caller("ALL"), "hotel_rooms.view")).toBeNull();
  });

  test("AREA ve las zonas asignadas y todos sus descendientes, nada fuera", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: ["norte"] }) as never);
    const visible = await svc.visibleZoneIds(caller("AREA"), "hotel_rooms.view");
    expect([...(visible ?? [])].sort()).toEqual(["norte", "norte-ala-a", "norte-p1", "norte-p2"]);
  });

  test("AREA sin zonas asignadas no ve nada (nunca todo)", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: [] }) as never);
    const visible = await svc.visibleZoneIds(caller("AREA"), "hotel_rooms.view");
    expect(visible?.size).toBe(0);
  });

  test("OWN no da zonas: el alcance propio de habitaciones no aplica", async () => {
    const svc = new HotelRoomsService(makeDb({ supervised: ["norte"] }) as never);
    const visible = await svc.visibleZoneIds(caller("OWN"), "hotel_rooms.view");
    expect(visible?.size).toBe(0);
  });
});
