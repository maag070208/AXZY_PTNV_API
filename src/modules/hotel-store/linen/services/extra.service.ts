import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  filterDateRange,
  filterEnum,
  filterId,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelExtraCollectInput, HotelExtraCreateInput, HotelExtraDeliverInput } from "../models/dto/extra.dto";
import type { HotelSignatureService } from "./signature.service";
import { resolveDirtyWarehouse } from "./dirty-destination";
import { zoneSubtree } from "./supply-request-rules";
import { locationIdsOf, runSerializable, warehouseOfKind } from "./linen-locations";
import { notifyUsers, userIdsByRoles, zoneSupervisorIds, type Notifier } from "./extra-recipients";
import { reportMissing } from "./loan-missing";
import {
  assertCanCancel,
  assertCanCollect,
  assertCanDeliver,
  extraKindOf,
  missingOf,
  splitByLots,
  statusAfterCollect,
} from "./extra-rules";

/** Mismo valor en el movimiento ROOM_EXTRA (`sourceDocType`) y en las firmas; F5 lo lee por ahí. */
export const EXTRA_DOC = "ROOM_EXTRA";
/** Roles de Recepción a los que se avisa de faltantes y cargos. */
export const RECEPTION_ROLES = ["RECEPCION"];

const STATUSES = ["REQUESTED", "DELIVERED", "COLLECTED", "MISSING", "CANCELLED"] as const;
const KINDS = ["LINEN", "CONSUMABLE"] as const;
const INCLUDE = {
  room: { select: { id: true, number: true, status: true, zoneId: true, zone: { select: { id: true, name: true } } } },
  product: { select: { id: true, code: true, name: true, size: true } },
  sourceWarehouse: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  deliveredBy: { select: { id: true, name: true } },
  collectedBy: { select: { id: true, name: true } },
} as const;
type ExtraRow = Prisma.HotelRoomExtraGetPayload<{ include: typeof INCLUDE }>;

export const extraView = (e: ExtraRow) => ({
  id: e.id,
  room: e.room,
  product: e.product,
  quantity: Number(e.quantity),
  kind: e.kind,
  sourceWarehouse: e.sourceWarehouse,
  notes: e.notes,
  status: e.status,
  requestedBy: e.requestedBy,
  requestedAt: e.requestedAt,
  deliveredBy: e.deliveredBy,
  deliveredAt: e.deliveredAt,
  collectedBy: e.collectedBy,
  collectedAt: e.collectedAt,
  collectedQty: e.collectedQty === null ? null : Number(e.collectedQty),
  missingQty: Number(e.missingQty),
});

/**
 * Blancos y amenidades adicionales a una habitación (Etapa 2, paso 11). Salen de la dotación de
 * Recepción (ROOM_EXTRA); el blanco entregado se recolecta y regresa a DIRTY de la zona
 * (EXTRA_RETURN) y lo que falta queda MISSING con baja pendiente motivo F. El consumible no se
 * recolecta: DELIVERED es final y cuenta para el consumo esperado.
 */
export class HotelExtraService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Punto de dotación: el indicado (debe ser POINT) o REC. */
  async sourcePoint(warehouseId?: string | null) {
    if (warehouseId) return warehouseOfKind(this.db, "POINT", warehouseId, "HOTEL_EXTRA_SOURCE_INVALID");
    const rec = await this.db.hotelWarehouse.findFirst({ where: { code: "REC", kind: "POINT", active: true }, select: { id: true, code: true, kind: true, active: true, zoneId: true } });
    return rec ?? warehouseOfKind(this.db, "POINT", null, "HOTEL_EXTRA_SOURCE_INVALID");
  }

  async create(input: HotelExtraCreateInput, actorId: string, source: { id: string }) {
    const room = await this.db.hotelRoom.findUnique({ where: { id: input.roomId }, select: { id: true, number: true, zoneId: true, active: true } });
    if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    const product = await this.db.hotelProduct.findUnique({ where: { id: input.productId }, select: { id: true, code: true, name: true, kind: true, active: true } });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    const kind = extraKindOf(product.kind);
    const general = (await locationIdsOf(this.db, source.id)).get("GENERAL") ?? null;

    const id = randomUUID();
    const created = await runSerializable(async (tx) => {
      const movementInput = {
        type: "ROOM_EXTRA" as const,
        fromWarehouseId: source.id,
        roomId: room.id,
        sourceDocType: EXTRA_DOC,
        sourceDocId: id,
        notes: `Adicional a habitación ${room.number}`,
        lines: [{ productId: product.id, quantity: input.quantity, fromLocationId: general }],
      };
      assertMovementShape("ROOM_EXTRA", movementInput);
      const movement = await this.movements.applyInTransaction(tx, movementInput, actorId, null);
      return tx.hotelRoomExtra.create({
        data: {
          id,
          roomId: room.id,
          productId: product.id,
          quantity: input.quantity,
          kind,
          sourceWarehouseId: source.id,
          notes: input.notes ?? null,
          requestedById: actorId,
          movementId: movement.id,
        },
        include: INCLUDE,
      });
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_EXTRA_CREATED",
      entityType: "HotelRoomExtra",
      entityId: created.id,
      userId: actorId,
      newState: { room: room.id, product: product.id, quantity: input.quantity, kind },
    });
    await notifyUsers(
      this.notifications,
      await zoneSupervisorIds(this.db, room.zoneId),
      {
        type: "HOTEL_LINEN_EXTRA",
        title: `Adicional para la habitación ${room.number}`,
        detail: `${input.quantity} × ${product.name}${input.notes ? ` · ${input.notes}` : ""}`,
      },
      actorId
    );
    return extraView(created);
  }

  /** Entrega: firma quien lleva el adicional (cosign del auxiliar de piso, o la sesión). */
  async deliver(id: string, input: HotelExtraDeliverInput, actorId: string) {
    const delivererId = input.cosignToken ? await this.signatures.resolveCosignUser(input.cosignToken) : actorId;
    const method = input.cosignToken ? "PASSWORD" : "SESSION";
    await runSerializable(async (tx) => {
      const extra = await tx.hotelRoomExtra.findUnique({ where: { id }, select: { status: true } });
      if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
      assertCanDeliver(extra.status);
      await tx.hotelRoomExtra.update({ where: { id }, data: { status: "DELIVERED", deliveredById: delivererId, deliveredAt: new Date() } });
      await this.signatures.sign(EXTRA_DOC, id, "DELIVERS", delivererId, method, tx);
    }, this.db);
    await this.audit?.({ action: "HOTEL_LINEN_EXTRA_DELIVERED", entityType: "HotelRoomExtra", entityId: id, userId: actorId, newState: { deliveredBy: delivererId } });
    return this.get(id);
  }

  /** Cancela un adicional aún no entregado: regresa a la dotación de Recepción. */
  async cancel(id: string, actorId: string) {
    await runSerializable(async (tx) => {
      const extra = await tx.hotelRoomExtra.findUnique({ where: { id } });
      if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
      assertCanCancel(extra.status);
      const general = (await locationIdsOf(tx, extra.sourceWarehouseId)).get("GENERAL");
      if (!general) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "GENERAL" });
      const lines = await this.originalLots(tx, extra);
      await this.returnStock(tx, extra, extra.sourceWarehouseId, general, lines, actorId, "Cancelación de adicional");
      await tx.hotelRoomExtra.update({ where: { id }, data: { status: "CANCELLED" } });
    }, this.db);
    await this.audit?.({ action: "HOTEL_LINEN_EXTRA_CANCELLED", entityType: "HotelRoomExtra", entityId: id, userId: actorId, newState: {} });
    return this.get(id);
  }

  /** Recolección: lo recolectado regresa a DIRTY de la zona; el faltante queda MISSING con baja pendiente F. */
  async collect(id: string, input: HotelExtraCollectInput, actorId: string) {
    const result = await runSerializable(async (tx) => {
      const extra = await tx.hotelRoomExtra.findUnique({ where: { id }, include: { room: { select: { number: true, zoneId: true } }, product: { select: { name: true } } } });
      if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
      assertCanCollect(extra.status, extra.kind);
      const quantity = Number(extra.quantity);
      const missing = missingOf(quantity, input.collectedQty);
      const lots = await this.originalLots(tx, extra);
      const collectedLots = splitByLots(lots, input.collectedQty);
      // Lo que queda por lote tras la parte recolectada, para regresar el faltante a la dotación.
      const taken = new Map(collectedLots.map((l) => [l.lotId, l.quantity]));
      const missingLots = lots
        .map((l) => ({ lotId: l.lotId, quantity: l.quantity - (taken.get(l.lotId) ?? 0) }))
        .filter((l) => l.quantity > 1e-9);

      if (collectedLots.length > 0) {
        const target = await this.dirtyTarget(tx, extra.room.zoneId);
        await this.returnStock(tx, extra, target.warehouseId, target.locationId, collectedLots, actorId, `Recolección de adicional, hab. ${extra.room.number}`);
      }
      if (missing > 0) {
        // El faltante vuelve a la dotación solo para que la baja pendiente (F) tenga existencia que reservar.
        const general = (await locationIdsOf(tx, extra.sourceWarehouseId)).get("GENERAL");
        if (!general) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "GENERAL" });
        await this.returnStock(tx, extra, extra.sourceWarehouseId, general, missingLots, actorId, `Faltante de adicional, hab. ${extra.room.number}`);
        await reportMissing(tx, {
          warehouseId: extra.sourceWarehouseId,
          locationId: general,
          productId: extra.productId,
          quantity: missing,
          actorId,
          sourceDocId: extra.id,
          notes: `Adicional no recolectado, hab. ${extra.room.number}`,
          movements: this.movements,
        });
      }
      await tx.hotelRoomExtra.update({
        where: { id },
        data: { status: statusAfterCollect(missing), collectedById: actorId, collectedAt: new Date(), collectedQty: input.collectedQty, missingQty: missing },
      });
      return { missing, room: extra.room.number, product: extra.product.name };
    }, this.db);
    await this.audit?.({
      action: result.missing > 0 ? "HOTEL_LINEN_EXTRA_MISSING" : "HOTEL_LINEN_EXTRA_COLLECTED",
      entityType: "HotelRoomExtra",
      entityId: id,
      userId: actorId,
      newState: { collectedQty: input.collectedQty, missingQty: result.missing },
    });
    if (result.missing > 0) {
      await notifyUsers(this.notifications, await userIdsByRoles(this.db, RECEPTION_ROLES), {
        type: "HOTEL_LINEN_EXTRA_MISSING",
        title: `Faltante de adicional en la habitación ${result.room}`,
        detail: `${result.missing} × ${result.product} sin recolectar`,
      });
    }
    return this.get(id);
  }

  /** Zona de la habitación del adicional (para validar el alcance antes de operar). */
  async zoneOf(id: string): Promise<string> {
    const extra = await this.db.hotelRoomExtra.findUnique({ where: { id }, select: { room: { select: { zoneId: true } } } });
    if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
    return extra.room.zoneId;
  }

  async get(id: string) {
    const extra = await this.db.hotelRoomExtra.findUnique({ where: { id }, include: INCLUDE });
    if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
    return extraView(extra);
  }

  /** Tabla server-side. Filtros: status, kind, room, date. `zoneIds` null = todas. */
  async table(params: ITDataTableFetchParams, zoneIds: Set<string> | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const kind = filterEnum(f, "kind", KINDS);
    const room = filterId(f, "room");
    const date = filterDateRange(f, "date");
    const where: Prisma.HotelRoomExtraWhereInput = {
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...(room ? { roomId: room } : {}),
      ...(date ? { requestedAt: date } : {}),
      ...(zoneIds ? { room: { zoneId: { in: [...zoneIds] } } } : {}),
    };
    const orderBy = orderByOf(params.sort, { requestedAt: "requestedAt", status: "status" }, [{ requestedAt: "desc" }]) as Prisma.HotelRoomExtraOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelRoomExtra.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: INCLUDE }),
      this.db.hotelRoomExtra.count({ where }),
    ]);
    return { total, data: rows.map(extraView) };
  }

  /**
   * Tablero de la supervisora: habitaciones con adicionales abiertos (solicitados o blancos ya
   * entregados que faltan por recolectar), agrupadas por zona. `collectNow` resalta las
   * habitaciones en limpieza (salida) con blancos por recoger.
   */
  async board(zoneIds: Set<string> | null) {
    const rows = await this.db.hotelRoomExtra.findMany({
      where: {
        OR: [{ status: "REQUESTED" }, { status: "DELIVERED", kind: "LINEN" }],
        ...(zoneIds ? { room: { zoneId: { in: [...zoneIds] } } } : {}),
      },
      include: INCLUDE,
      orderBy: { requestedAt: "asc" },
    });
    const zones = new Map<string, { zone: { id: string; name: string }; rooms: Map<string, { room: { id: string; number: string; status: string }; collectNow: boolean; extras: ReturnType<typeof extraView>[] }> }>();
    for (const row of rows) {
      const zone = zones.get(row.room.zoneId) ?? { zone: row.room.zone, rooms: new Map() };
      const entry = zone.rooms.get(row.roomId) ?? { room: { id: row.room.id, number: row.room.number, status: row.room.status }, collectNow: false, extras: [] };
      entry.extras.push(extraView(row));
      if (row.status === "DELIVERED" && row.room.status === "CLEANING") entry.collectNow = true;
      zone.rooms.set(row.roomId, entry);
      zones.set(row.room.zoneId, zone);
    }
    return {
      zones: [...zones.values()]
        .sort((a, b) => a.zone.name.localeCompare(b.zone.name))
        .map((z) => ({
          zone: z.zone,
          rooms: [...z.rooms.values()].sort((a, b) => a.room.number.localeCompare(b.room.number, undefined, { numeric: true })),
        })),
    };
  }

  /** Lotes de los que salió el adicional (movimiento ROOM_EXTRA original). */
  private async originalLots(tx: Prisma.TransactionClient, extra: { movementId: string | null; productId: string; quantity: Prisma.Decimal }) {
    if (!extra.movementId) throw new HttpError(409, "HOTEL_EXTRA_INVALID_STATE");
    const lines = await tx.hotelMovementLine.findMany({ where: { movementId: extra.movementId }, select: { lotId: true, quantity: true }, orderBy: { id: "asc" } });
    return lines.map((l) => ({ lotId: l.lotId, quantity: Number(l.quantity) }));
  }

  /** EXTRA_RETURN: entra al destino con sus lotes originales. */
  private async returnStock(
    tx: Prisma.TransactionClient,
    extra: { id: string; productId: string; roomId: string },
    warehouseId: string,
    locationId: string,
    lots: Array<{ lotId: string; quantity: number }>,
    actorId: string,
    notes: string
  ) {
    if (lots.length === 0) return;
    const movementInput = {
      type: "EXTRA_RETURN" as const,
      warehouseId,
      roomId: extra.roomId,
      sourceDocType: EXTRA_DOC,
      sourceDocId: extra.id,
      notes,
      lines: lots.map((l) => ({ productId: extra.productId, quantity: l.quantity, lotId: l.lotId, toLocationId: locationId })),
    };
    assertMovementShape("EXTRA_RETURN", movementInput);
    await this.movements.applyInTransaction(tx, movementInput, actorId, null);
  }

  /** DIRTY del almacén ZONE de la zona de la habitación (subiendo por el árbol); sin él, DIRTY de lavandería. */
  private async dirtyTarget(tx: Prisma.TransactionClient, roomZoneId: string) {
    const [zones, zoneWarehouses] = await Promise.all([
      tx.hotelZone.findMany({ select: { id: true, parentId: true } }),
      tx.hotelWarehouse.findMany({ where: { kind: "ZONE", active: true }, select: { id: true, zoneId: true }, orderBy: { code: "asc" } }),
    ]);
    const found = resolveDirtyWarehouse({ cartZoneId: null, roomZoneId, zones, zoneWarehouses });
    const warehouseId = found ?? (await warehouseOfKind(tx, "LAUNDRY", null, "HOTEL_LAUNDRY_NOT_CONFIGURED")).id;
    const locationId = (await locationIdsOf(tx, warehouseId)).get("DIRTY");
    if (!locationId) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "DIRTY" });
    return { warehouseId, locationId };
  }
}

/**
 * Blancos adicionales entregados a las habitaciones del área (zona del almacén y descendientes)
 * entre `from` y `to`, por producto. La conciliación diaria lo suma a "entregado a piso".
 */
export const roomExtrasDelivered = async (
  db: PrismaClient | Prisma.TransactionClient,
  zoneWarehouseId: string,
  from: Date,
  to: Date
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  const warehouse = await db.hotelWarehouse.findUnique({ where: { id: zoneWarehouseId }, select: { zoneId: true } });
  if (!warehouse?.zoneId) return out;
  const zones = await db.hotelZone.findMany({ select: { id: true, parentId: true } });
  const zoneIds = [...zoneSubtree(zones, warehouse.zoneId)];
  const rows = await db.hotelRoomExtra.groupBy({
    by: ["productId"],
    where: {
      kind: "LINEN",
      status: { in: ["DELIVERED", "COLLECTED", "MISSING"] },
      deliveredAt: { gte: from, lt: to },
      room: { zoneId: { in: zoneIds } },
    },
    _sum: { quantity: true },
  });
  for (const r of rows) out.set(r.productId, Number(r._sum.quantity ?? 0));
  return out;
};
