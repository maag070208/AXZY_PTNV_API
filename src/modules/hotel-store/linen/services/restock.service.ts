import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { expectedForRoom } from "./room-par-rules";
import { restockLine, sumExpected } from "./restock-rules";
import { zoneSubtree } from "./supply-request-rules";
import type { HotelSupplyRequestService } from "./supply-request.service";

/** Pedidos de área abiertos: lo pendiente por surtir cuenta como "en camino". */
const OPEN_REQUEST_STATUSES = ["DRAFT", "SUBMITTED", "PARTIALLY_FULFILLED"] as const;

/**
 * Reposición por dotación: objetivo = Σ esperado de las habitaciones activas de la zona del área ×
 * factor; tiene = existencia del área sin el sucio; en camino = traspasos IN_TRANSIT hacia el área +
 * pendiente de pedidos abiertos (lo ya surtido está en el traspaso, no se cuenta dos veces).
 */
export class HotelRestockService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly requests: HotelSupplyRequestService,
    private readonly audit?: AuditLogger
  ) {}

  async compute(warehouseId: string, factor: number) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { id: true, code: true, name: true, kind: true, zoneId: true, active: true } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (warehouse.kind !== "ZONE" || !warehouse.zoneId || !warehouse.active) throw new HttpError(422, "HOTEL_RESTOCK_AREA_INVALID");

    const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
    const zoneIds = [...zoneSubtree(zones, warehouse.zoneId)];
    const [rooms, pars, stock, transit, open] = await Promise.all([
      this.db.hotelRoom.findMany({ where: { active: true, zoneId: { in: zoneIds } }, select: { kingBeds: true, queenBeds: true, sofaBeds: true, bathrooms: true } }),
      this.db.hotelRoomPar.findMany({ where: { product: { kind: "LINEN", active: true } } }),
      this.db.hotelStock.findMany({
        where: { warehouseId, quantity: { gt: 0 }, product: { kind: "LINEN" }, location: { code: { not: "DIRTY" } } },
        select: { productId: true, quantity: true },
      }),
      this.db.hotelMovementLine.findMany({
        where: { movement: { status: "IN_TRANSIT", warehouseId }, product: { kind: "LINEN" } },
        select: { productId: true, quantity: true },
      }),
      this.db.hotelSupplyRequestLine.findMany({
        where: { request: { requestingWarehouseId: warehouseId, status: { in: [...OPEN_REQUEST_STATUSES] } }, product: { kind: "LINEN" } },
        select: { productId: true, requestedQty: true, deliveredQty: true },
      }),
    ]);

    const expected = sumExpected(rooms.map((room) => expectedForRoom(room, pars)));
    const sum = (rows: Array<{ productId: string; quantity: unknown }>) => {
      const out = new Map<string, number>();
      for (const r of rows) out.set(r.productId, (out.get(r.productId) ?? 0) + Number(r.quantity));
      return out;
    };
    const onHand = sum(stock);
    const incoming = sum([
      ...transit,
      ...open.map((l) => ({ productId: l.productId, quantity: Math.max(0, Number(l.requestedQty) - Number(l.deliveredQty)) })),
    ]);

    const ids = new Set([...expected.keys()]);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: [...ids] } }, select: { id: true, code: true, name: true, size: true } });
    const lines = products
      .map((p) => ({
        productId: p.id,
        code: p.code,
        name: p.name,
        size: p.size,
        ...restockLine({ expected: expected.get(p.id) ?? 0, factor, onHand: onHand.get(p.id) ?? 0, incoming: incoming.get(p.id) ?? 0 }),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
      factor,
      rooms: rooms.length,
      totals: {
        target: lines.reduce((s, l) => s + l.target, 0),
        onHand: lines.reduce((s, l) => s + l.onHand, 0),
        incoming: lines.reduce((s, l) => s + l.incoming, 0),
        deficit: lines.reduce((s, l) => s + l.deficit, 0),
      },
      lines,
    };
  }

  /** Crea un pedido de área (DRAFT) con el déficit como cantidad pedida; 409 si no hay déficit. */
  async request(warehouseId: string, factor: number, actorId: string) {
    const result = await this.compute(warehouseId, factor);
    const lines = result.lines.filter((l) => l.deficit > 0).map((l) => ({ productId: l.productId, requestedQty: l.deficit }));
    if (lines.length === 0) throw new HttpError(409, "HOTEL_RESTOCK_NO_DEFICIT");
    const created = await this.requests.create({ requestingWarehouseId: warehouseId, checkouts: 0, occupied: 0, notes: `Reposición por dotación x${factor}`, lines }, actorId);
    await this.audit?.({
      action: "HOTEL_LINEN_RESTOCK_REQUESTED",
      entityType: "HotelSupplyRequest",
      entityId: created.id,
      userId: actorId,
      previousState: {},
      newState: { warehouseId, factor, lines: lines.length, deficit: result.totals.deficit },
    });
    return created;
  }
}
