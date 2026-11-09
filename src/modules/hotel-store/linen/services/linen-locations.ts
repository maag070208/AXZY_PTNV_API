import { Prisma, type PrismaClient } from "@prisma/client";
import type { ErrorCode } from "@core/i18n";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

type Db = PrismaClient | Prisma.TransactionClient;

/** Id de la ubicación activa `code` de un almacén (422 si no existe). */
export const locationIdByCode = async (db: Db, warehouseId: string, code: string): Promise<string> => {
  const location = await db.hotelLocation.findFirst({ where: { warehouseId, code, active: true }, select: { id: true } });
  if (!location) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { warehouseId, code });
  return location.id;
};

/** Mapa código -> id de las ubicaciones activas de un almacén. */
export const locationIdsOf = async (db: Db, warehouseId: string): Promise<Map<string, string>> => {
  const rows = await db.hotelLocation.findMany({ where: { warehouseId, active: true }, select: { id: true, code: true } });
  return new Map(rows.map((r) => [r.code, r.id]));
};

/** Almacén activo de un tipo (el primero por código, o el indicado si es de ese tipo). */
export const warehouseOfKind = async (db: Db, kind: string, id?: string | null, errorCode: ErrorCode = "HOTEL_WAREHOUSE_KIND_INVALID") => {
  if (id) {
    const warehouse = await db.hotelWarehouse.findUnique({ where: { id }, select: { id: true, code: true, kind: true, active: true, zoneId: true } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (warehouse.kind !== kind || !warehouse.active) throw new HttpError(422, errorCode);
    return warehouse;
  }
  const first = await db.hotelWarehouse.findFirst({
    where: { kind: kind as never, active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, kind: true, active: true, zoneId: true },
  });
  if (!first) throw new HttpError(422, errorCode);
  return first;
};

/** Reintenta una transacción SERIALIZABLE ante conflicto de serialización (P2034). */
export const runSerializable = async <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  db: PrismaClient = prismaClient,
  maxAttempts = 3
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if ((err as { code?: string })?.code === "P2034" && attempt < maxAttempts) continue;
      throw err;
    }
  }
};
