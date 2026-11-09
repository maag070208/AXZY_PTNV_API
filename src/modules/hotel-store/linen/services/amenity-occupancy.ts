import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { endOfLocalDay, startOfLocalDay } from "@core/utils/timezone";
import { countOccupiedNights, dayKeys } from "./amenity-rules";

/**
 * Noches ocupadas (D13): por cada día de `fromKey` a `toKey` (inclusive), habitaciones activas de las zonas
 * cuyo estado a las 23:59 (hora local de `tz`) era OCCUPIED, según `HotelRoomStatusChange`.
 */
export const occupiedRoomNights = async (
  zoneIds: string[],
  fromKey: string,
  toKey: string,
  tz: string,
  db: PrismaClient = prismaClient
): Promise<number> => {
  if (zoneIds.length === 0) return 0;
  const rooms = await db.hotelRoom.findMany({ where: { active: true, zoneId: { in: zoneIds } }, select: { id: true } });
  if (rooms.length === 0) return 0;
  const roomIds = rooms.map((r) => r.id);
  const start = startOfLocalDay(fromKey, tz);
  const end = endOfLocalDay(toKey, tz);
  // Último cambio previo al rango por habitación (estado con el que arranca) + los cambios dentro del rango.
  const [previous, within] = await Promise.all([
    db.hotelRoomStatusChange.findMany({
      where: { roomId: { in: roomIds }, createdAt: { lt: start } },
      orderBy: [{ roomId: "asc" }, { createdAt: "desc" }],
      distinct: ["roomId"],
      select: { roomId: true, to: true, createdAt: true },
    }),
    db.hotelRoomStatusChange.findMany({
      where: { roomId: { in: roomIds }, createdAt: { gte: start, lt: end } },
      select: { roomId: true, to: true, createdAt: true },
    }),
  ]);
  const cutoffs = dayKeys(fromKey, toKey).map((key) => new Date(endOfLocalDay(key, tz).getTime() - 60_000));
  return countOccupiedNights([...previous, ...within], cutoffs);
};
