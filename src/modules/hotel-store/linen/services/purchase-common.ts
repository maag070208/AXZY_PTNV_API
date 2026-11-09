import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTolerancePct } from "./purchase-rules";

type Db = PrismaClient | Prisma.TransactionClient;

/** Series propias del hotel en `document_sequences` (year 0 = sin reinicio anual). */
export const PURCHASE_ORDER_SEQ = "HOTEL_PO";
export const PURCHASE_REQUEST_SEQ = "HOTEL_PR";
export const PURCHASE_ORDER_DOC = "HOTEL_PURCHASE_ORDER";

/** Siguiente folio con incremento atómico: dos altas simultáneas nunca reparten el mismo. */
export const nextFolio = async (tx: Prisma.TransactionClient, type: string, prefix: string): Promise<string> => {
  const rows = await tx.$queryRaw<Array<{ last: number }>>`
    INSERT INTO document_sequences ("type", "year", "last", "updatedAt")
    VALUES (${type}, 0, 1, now())
    ON CONFLICT ("type", "year") DO UPDATE SET "last" = document_sequences."last" + 1, "updatedAt" = now()
    RETURNING "last"
  `;
  return `${prefix}-${String(Number(rows[0]?.last ?? 1)).padStart(4, "0")}`;
};

/** Id -> nombre de usuario (los ids de usuario de compras son texto simple, sin relación). */
export const userNames = async (db: Db, ids: Array<string | null | undefined>): Promise<Map<string, string>> => {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
};

const named = (names: Map<string, string>, id: string | null | undefined) => (id ? { id, name: names.get(id) ?? null } : null);
export const userRef = named;

/** Almacén que recibe: el indicado (CENTRAL o NEW_LINEN activo) o el CENTRAL `ALM`/primero. */
export const receivingWarehouse = async (db: Db, id?: string | null) => {
  const select = { id: true, code: true, name: true, kind: true, active: true } as const;
  if (id) {
    const warehouse = await db.hotelWarehouse.findUnique({ where: { id }, select });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (!warehouse.active || !["CENTRAL", "NEW_LINEN"].includes(warehouse.kind)) throw new HttpError(422, "HOTEL_PO_WAREHOUSE_INVALID");
    return warehouse;
  }
  const found =
    (await db.hotelWarehouse.findFirst({ where: { kind: "CENTRAL", active: true, code: "ALM" }, select })) ??
    (await db.hotelWarehouse.findFirst({ where: { kind: "CENTRAL", active: true }, orderBy: { code: "asc" }, select }));
  if (!found) throw new HttpError(422, "HOTEL_PO_WAREHOUSE_INVALID");
  return found;
};

/** Tolerancia de recibir de más (P3), en %: `HOTEL_PO_OVER_TOLERANCE_PCT` de sys_config, 10 por defecto. */
export const readTolerancePct = async (db: Db): Promise<number> => {
  const row = await db.sysConfig.findUnique({ where: { key: "HOTEL_PO_OVER_TOLERANCE_PCT" }, select: { value: true } });
  return parseTolerancePct(row?.value);
};

export const num = (d: Prisma.Decimal | number | null | undefined): number => (d === null || d === undefined ? 0 : Number(d));
