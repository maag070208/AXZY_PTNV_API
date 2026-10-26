import { test, expect } from "@playwright/test";
import { HotelRoomsService, type Caller } from "../../src/modules/hotel-store/services/rooms.service";

/**
 * M1-U04: matriz de transiciones completa (tabla de verdad). Cada par de estados
 * se prueba contra la matriz del plan (hotel-almacen/01-M1, sección 4). Lo que no
 * esté en la tabla responde 409 HOTEL_ROOM_TRANSITION_INVALID.
 */
type Status = "LIMPIEZA" | "INSPECCION" | "DISPONIBLE" | "OCUPADA" | "MANTENIMIENTO" | "FUERA_SERVICIO";
const STATUSES: Status[] = ["LIMPIEZA", "INSPECCION", "DISPONIBLE", "OCUPADA", "MANTENIMIENTO", "FUERA_SERVICIO"];
const REASON_REQUIRED = new Set<string>(["MANTENIMIENTO", "FUERA_SERVICIO"]);

/** Matriz del plan: de → a, con el permiso que la autoriza. */
const PLAN: Array<{ from: Status; to: Status; permission: string; systemOnly?: boolean; requiresActiveKit?: boolean }> = [
  { from: "DISPONIBLE", to: "OCUPADA", permission: "hotel_rooms.status" },
  { from: "OCUPADA", to: "LIMPIEZA", permission: "hotel_rooms.status" },
  { from: "DISPONIBLE", to: "LIMPIEZA", permission: "hotel_rooms.status" },
  { from: "LIMPIEZA", to: "INSPECCION", permission: "hotel_rooms.status", systemOnly: true },
  { from: "LIMPIEZA", to: "DISPONIBLE", permission: "hotel_rooms.status", systemOnly: true },
  { from: "INSPECCION", to: "DISPONIBLE", permission: "housekeeping.inspect" },
  { from: "INSPECCION", to: "LIMPIEZA", permission: "housekeeping.inspect" },
  { from: "DISPONIBLE", to: "MANTENIMIENTO", permission: "hotel_rooms.status" },
  { from: "OCUPADA", to: "MANTENIMIENTO", permission: "hotel_rooms.status" },
  { from: "LIMPIEZA", to: "MANTENIMIENTO", permission: "hotel_rooms.status" },
  { from: "INSPECCION", to: "MANTENIMIENTO", permission: "hotel_rooms.status" },
  { from: "DISPONIBLE", to: "FUERA_SERVICIO", permission: "hotel_rooms.status" },
  { from: "OCUPADA", to: "FUERA_SERVICIO", permission: "hotel_rooms.status" },
  { from: "LIMPIEZA", to: "FUERA_SERVICIO", permission: "hotel_rooms.status" },
  { from: "INSPECCION", to: "FUERA_SERVICIO", permission: "hotel_rooms.status" },
  { from: "MANTENIMIENTO", to: "LIMPIEZA", permission: "hotel_rooms.status" },
  { from: "FUERA_SERVICIO", to: "LIMPIEZA", permission: "hotel_rooms.status" },
];

/** Base falsa: la matriz activa es la del plan, sin filas extra. */
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
      // Las marcadas `systemOnly` las hace el sistema (M5): a un usuario le responden 409.
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

  test("OCUPADA → LIMPIEZA no exige kit (P1): la tarea con alerta la crea M5", async () => {
    const { db, updates } = makeDb("OCUPADA");
    (db.hotelRoom as { findUnique: () => Promise<unknown> }).findUnique = async () => ({
      id: "r1",
      zoneId: "z1",
      active: true,
      status: "OCUPADA",
      type: { id: "t1", kitId: null, kit: null },
    });
    const svc = new HotelRoomsService(db as never);
    expect(await codeOf(() => svc.changeStatus(caller(), "r1", { to: "LIMPIEZA" }))).toBeNull();
    expect(updates).toEqual(["LIMPIEZA"]);
  });
});
