import { Prisma, type HotelMovementStatus, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { filterDateRange, filterEnum, filterId, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelAmenityDeliveryCreateInput } from "../models/dto/amenity-delivery.dto";
import { amenityFolio, amenitySuggestion, assertAmenityRoute, assertRecipientValid } from "./amenity-delivery-rules";
import { notifyUsers, userIdsByRoles, zoneSupervisorIds, type Notifier } from "./extra-recipients";
import { runSerializable } from "./linen-locations";
import type { HotelLinenTransferService } from "./transfer.service";

export const RECIPIENT_ROLE = "HOUSEKEEPING_SUPERVISOR";
const STATUSES = ["IN_TRANSIT", "ACTIVE", "RECEIVED_WITH_DIFFERENCE", "CANCELLED"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const PRODUCT_SELECT = { id: true, code: true, name: true } as const;
const INCLUDE = {
  fromWarehouse: { select: WAREHOUSE_SELECT },
  warehouse: { select: WAREHOUSE_SELECT },
  createdBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true } },
  lines: { select: { quantity: true, receivedQuantity: true } },
} as const;
const num = (v: Prisma.Decimal | number | null | undefined): number => Number(v ?? 0);

/**
 * Entrega de amenidades (decisión 4): traspaso Almacén -> ropería con tipo AMENITY_DELIVERY, folio
 * propio EA-0001 y destinataria supervisora. Reusa movimiento/traspaso: sale del origen en IN_TRANSIT
 * y la destinataria recibe (firma) con el traspaso normal.
 */
export class HotelAmenityDeliveryService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly transfers: HotelLinenTransferService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Supervisoras de piso asignadas a la zona de la ropería (o a un ancestro). */
  async recipients(warehouseId: string) {
    const zoneId = await this.zoneOf(warehouseId);
    const supervisors = await zoneSupervisorIds(this.db, zoneId);
    const withRole = new Set(await userIdsByRoles(this.db, [RECIPIENT_ROLE]));
    const ids = supervisors.filter((id) => withRole.has(id));
    return this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  /** Sugerido por área = Σ esperado de las habitaciones activas de la zona (amenidades) − existencia del área. */
  async suggestion(warehouseId: string) {
    const zoneId = await this.zoneOf(warehouseId);
    const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
    const subtree = new Set<string>([zoneId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const z of zones) if (z.parentId && subtree.has(z.parentId) && !subtree.has(z.id)) { subtree.add(z.id); grew = true; }
    }
    const [rooms, pars, consumables, stock] = await Promise.all([
      this.db.hotelRoom.findMany({ where: { active: true, zoneId: { in: [...subtree] } }, select: { kingBeds: true, queenBeds: true, sofaBeds: true, bathrooms: true } }),
      this.db.hotelRoomPar.findMany({ select: { component: true, productId: true, quantity: true } }),
      this.db.hotelProduct.findMany({ where: { kind: "CONSUMABLE", active: true }, select: PRODUCT_SELECT }),
      this.db.hotelStock.groupBy({ by: ["productId"], where: { warehouseId }, _sum: { quantity: true } }),
    ]);
    const onHand = new Map(stock.map((s) => [s.productId, num(s._sum.quantity)]));
    const lines = amenitySuggestion(rooms, pars, new Set(consumables.map((p) => p.id)), onHand);
    const productOf = new Map(consumables.map((p) => [p.id, p]));
    return {
      warehouseId,
      zoneId,
      rooms: rooms.length,
      lines: lines.map((l) => ({ product: productOf.get(l.productId)!, expected: l.expected, onHand: l.onHand, suggested: l.suggested })),
    };
  }

  async create(input: HotelAmenityDeliveryCreateInput, actorId: string, requestId?: string | null) {
    if (requestId) {
      const existing = await this.db.hotelMovement.findUnique({ where: { requestId }, select: { id: true } });
      if (existing) return this.get(existing.id);
    }
    const warehouses = await this.db.hotelWarehouse.findMany({
      where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] } },
      select: { id: true, kind: true, zoneId: true, active: true },
    });
    const from = warehouses.find((w) => w.id === input.fromWarehouseId);
    const to = warehouses.find((w) => w.id === input.toWarehouseId);
    if (!from || !to || !from.active || !to.active) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    assertAmenityRoute(from.kind, to.kind);

    const recipient = await this.db.user.findUnique({ where: { id: input.recipientId }, select: { id: true, active: true } });
    if (!recipient || !recipient.active) throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_RECIPIENT_INVALID");
    const [roleIds, zoneIds] = await Promise.all([userIdsByRoles(this.db, [RECIPIENT_ROLE]), zoneSupervisorIds(this.db, to.zoneId)]);
    assertRecipientValid({ hasSupervisorRole: roleIds.includes(recipient.id), supervisesZone: zoneIds.includes(recipient.id) });

    const products = await this.db.hotelProduct.findMany({ where: { id: { in: input.lines.map((l) => l.productId) } }, select: { id: true, kind: true } });
    const kindOf = new Map(products.map((p) => [p.id, p.kind]));
    for (const l of input.lines) {
      if (kindOf.get(l.productId) !== "CONSUMABLE") throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_PRODUCT_INVALID", { productId: l.productId });
    }

    const movement = await runSerializable(async (tx) => {
      const created = await this.transfers.sendInTransaction(
        tx,
        { fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, lines: input.lines, notes: input.notes ?? null },
        actorId,
        actorId,
        requestId ?? null,
        { type: "AMENITY_DELIVERY" }
      );
      // Folio propio EA-0001 (el índice único protege la colisión); el MOV-H queda reemplazado.
      const count = await tx.hotelMovement.count({ where: { type: "AMENITY_DELIVERY" } });
      return tx.hotelMovement.update({ where: { id: created.id }, data: { folio: amenityFolio(count - 1), recipientId: recipient.id }, include: { lines: true } });
    }, this.db);

    await this.transfers.logSent(movement, input, actorId);
    await this.audit?.({
      action: "HOTEL_LINEN_AMENITY_DELIVERED",
      entityType: "HotelMovement",
      entityId: movement.id,
      userId: actorId,
      newState: { folio: movement.folio, from: input.fromWarehouseId, to: input.toWarehouseId, recipient: recipient.id, lines: movement.lines.length },
    });
    await notifyUsers(
      this.notifications,
      [recipient.id],
      { type: "HOTEL_LINEN_AMENITY_DELIVERY", title: `Entrega de amenidades ${movement.folio}`, detail: "Tienes una entrega por recibir" },
      actorId
    );
    return this.get(movement.id);
  }

  /** Detalle: el del traspaso (líneas, firmas, destinataria); 404 si no es una entrega de amenidades. */
  async get(id: string) {
    const m = await this.db.hotelMovement.findUnique({ where: { id }, select: { type: true } });
    if (!m || m.type !== "AMENITY_DELIVERY") throw new HttpError(404, "HOTEL_AMENITY_DELIVERY_NOT_FOUND");
    return this.transfers.get(id);
  }

  /** Tabla server-side. Filtros: status, to (ropería), folio, date. */
  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const to = filterId(f, "to");
    const folio = filterText(f, "folio");
    const date = filterDateRange(f, "date");
    const where: Prisma.HotelMovementWhereInput = {
      type: "AMENITY_DELIVERY",
      ...(status ? { status: status as HotelMovementStatus } : {}),
      ...(to ? { warehouseId: to } : {}),
      ...(folio ? { folio } : {}),
      ...(date ? { date } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", date: "date", status: "status" }, [{ date: "desc" }]) as Prisma.HotelMovementOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelMovement.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: INCLUDE }),
      this.db.hotelMovement.count({ where }),
    ]);
    return { total, data: rows.map(row) };
  }

  /** Historial de entregas a una ropería, de la más reciente a la más antigua. */
  async history(toWarehouseId: string, limit = 50) {
    const rows = await this.db.hotelMovement.findMany({
      where: { type: "AMENITY_DELIVERY", warehouseId: toWarehouseId },
      orderBy: { date: "desc" },
      take: limit,
      include: INCLUDE,
    });
    return rows.map(row);
  }

  /** Zona de una ropería de zona; 422 si no lo es. */
  private async zoneOf(warehouseId: string): Promise<string> {
    const w = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { kind: true, zoneId: true } });
    if (!w) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (w.kind !== "ZONE" || !w.zoneId) throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_TARGET_INVALID");
    return w.zoneId;
  }
}

type Row = Prisma.HotelMovementGetPayload<{ include: typeof INCLUDE }>;
const row = (m: Row) => {
  const sent = m.lines.reduce((s, l) => s + Number(l.quantity), 0);
  const received = m.receivedAt ? m.lines.reduce((s, l) => s + Number(l.receivedQuantity ?? 0), 0) : null;
  return {
    id: m.id,
    folio: m.folio,
    date: m.date,
    status: m.status,
    from: m.fromWarehouse,
    to: m.warehouse,
    sentBy: m.createdBy,
    recipient: m.recipient,
    receivedBy: m.receivedBy,
    receivedAt: m.receivedAt,
    lines: m.lines.length,
    sentQuantity: sent,
    receivedQuantity: received,
    difference: received === null ? null : sent - received,
  };
};
