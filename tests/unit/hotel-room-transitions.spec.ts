import { test, expect } from "@playwright/test";
import { HotelRoomsService, type Caller } from "../../src/modules/hotel-store/services/rooms.service";

/**
 * M1-U04: full transition matrix (truth table). Every pair of statuses
 * is checked against the plan matrix (hotel-almacen/01-M1, section 4). Anything not
 * in the table responds with 409 HOTEL_ROOM_TRANSITION_INVALID.
 */
type Status = "CLEANING" | "INSPECTION" | "AVAILABLE" | "OCCUPIED" | "MAINTENANCE" | "OUT_OF_SERVICE";
const STATUSES: Status[] = ["CLEANING", "INSPECTION", "AVAILABLE", "OCCUPIED", "MAINTENANCE", "OUT_OF_SERVICE"];
const REASON_REQUIRED = new Set<string>(["MAINTENANCE", "OUT_OF_SERVICE"]);

/** Plan matrix: from → to, with the permission that authorizes it. */
const PLAN: Array<{ from: Status; to: Status; permission: string; systemOnly?: boolean; requiresActiveKit?: boolean }> = [
  { from: "AVAILABLE", to: "OCCUPIED", permission: "hotel_rooms.status" },
  { from: "OCCUPIED", to: "CLEANING", permission: "hotel_rooms.status" },
  { from: "AVAILABLE", to: "CLEANING", permission: "hotel_rooms.status" },
  { from: "CLEANING", to: "INSPECTION", permission: "hotel_rooms.status", systemOnly: true },
  { from: "CLEANING", to: "AVAILABLE", permission: "hotel_rooms.status", systemOnly: true },
  { from: "INSPECTION", to: "AVAILABLE", permission: "housekeeping.inspect" },
  { from: "INSPECTION", to: "CLEANING", permission: "housekeeping.inspect" },
  { from: "AVAILABLE", to: "MAINTENANCE", permission: "hotel_rooms.status" },
  { from: "OCCUPIED", to: "MAINTENANCE", permission: "hotel_rooms.status" },
  { from: "CLEANING", to: "MAINTENANCE", permission: "hotel_rooms.status" },
  { from: "INSPECTION", to: "MAINTENANCE", permission: "hotel_rooms.status" },
  { from: "AVAILABLE", to: "OUT_OF_SERVICE", permission: "hotel_rooms.status" },
  { from: "OCCUPIED", to: "OUT_OF_SERVICE", permission: "hotel_rooms.status" },
  { from: "CLEANING", to: "OUT_OF_SERVICE", permission: "hotel_rooms.status" },
  { from: "INSPECTION", to: "OUT_OF_SERVICE", permission: "hotel_rooms.status" },
  { from: "MAINTENANCE", to: "CLEANING", permission: "hotel_rooms.status" },
  { from: "OUT_OF_SERVICE", to: "CLEANING", permission: "hotel_rooms.status" },
];

/** Fake database: the active matrix is the plan's, with no extra rows. */
const makeDb = (from: Status) => {
  const updates: string[] = [];
  const db = {
    hotelRoom: {
      findUnique: async () => ({
        id: "r1",
        zoneId: "z1",
        active: true,
        status: from,
        type: { id: "t1", kitId: "k1", kit: { active: true } },
      }),
      update: async ({ data }: { data: { status: string } }) => {
        updates.push(data.status);
        return { id: "r1", status: data.status };
      },
    },
    hotelRoomStatusTransition: {
      findFirst: async ({ where }: { where: { from: Status; to: Status } }) => {
        const rule = PLAN.find((r) => r.from === where.from && r.to === where.to);
        return rule
          ? { ...rule, requiresReason: REASON_REQUIRED.has(rule.to), requiresActiveKit: rule.requiresActiveKit ?? false, active: true, systemOnly: rule.systemOnly ?? false }
          : null;
      },
    },
    hotelReason: { findFirst: async () => ({ id: "motivo" }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        hotelRoom: { update: (args: unknown) => db.hotelRoom.update(args as never) },
        hotelRoomStatusChange: { create: async () => ({}) },
      }),
  };
  return { db, updates };
};

const caller = (): Caller => ({
  id: "elena",
  role: "HOUSEKEEPING_SUPERVISOR",
  exceptions: [
    { permission: "hotel_rooms.status", scope: "ALL", expiresAt: null },
    { permission: "housekeeping.inspect", scope: "ALL", expiresAt: null },
  ],
});

const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "UNKNOWN";
  }
};

test.describe("M1-U04 matriz de transiciones (tabla de verdad)", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (from === to) continue;
      const planned = PLAN.find((r) => r.from === from && r.to === to);
      // Rows marked `systemOnly` are done by the system (M5): a user gets 409.
      const allowedForUser = planned && !planned.systemOnly;
      test(`${from} → ${to}: ${allowedForUser ? "permitido" : "409"}`, async () => {
        const { db, updates } = makeDb(from);
        const svc = new HotelRoomsService(db as never);
        const reasonId = REASON_REQUIRED.has(to) ? "motivo" : undefined;
        const result = await codeOf(() => svc.changeStatus(caller(), "r1", { to, reasonId }));
        if (allowedForUser) {
          expect(result).toBeNull();
          expect(updates).toEqual([to]);
        } else {
          expect(result).toBe("HOTEL_ROOM_TRANSITION_INVALID");
          expect(updates).toEqual([]);
        }
      });
    }
  }

  test("OCCUPIED → CLEANING no exige kit (P1): la tarea con alerta la crea M5", async () => {
    const { db, updates } = makeDb("OCCUPIED");
    (db.hotelRoom as { findUnique: () => Promise<unknown> }).findUnique = async () => ({
      id: "r1",
      zoneId: "z1",
      active: true,
      status: "OCCUPIED",
      type: { id: "t1", kitId: null, kit: null },
    });
    const svc = new HotelRoomsService(db as never);
    expect(await codeOf(() => svc.changeStatus(caller(), "r1", { to: "CLEANING" }))).toBeNull();
    expect(updates).toEqual(["CLEANING"]);
  });
});
