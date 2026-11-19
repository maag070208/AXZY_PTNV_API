import { Prisma, type HotelSupplyRequestStatus, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  filterDateRange,
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import { assertWholeQuantity } from "../../services/hotel-catalog-rules";
import type { HotelSignatureService } from "./signature.service";
import { SUPPLY_REQUEST_DOC, type HotelLinenTransferService } from "./transfer.service";
import type {
  HotelRoomTurnoverInput,
  HotelSupplyAddLinesInput,
  HotelSupplyDeliverInput,
  HotelSupplyDifferenceInput,
  HotelSupplyRequestCreateInput,
  HotelSupplyRequestFulfillInput,
} from "../models/dto/laundry.dto";
import type { Caller, HotelRoomsService } from "../../services/rooms.service";
import { HotelMovementService } from "../../services/movement.service";
import { assertMovementShape } from "../../services/kardex-rules";
import { HotelRoomParService } from "./room-par.service";
import { notifyUsers, userIdsByRoles, zoneSupervisorIds, type Notifier } from "./extra-recipients";
import { FLOOR_ASSISTANT_ROLE, LAUNDRY_ROLE } from "./role-scope-rules";
import {
  OPEN_TURNOVER_STATUSES,
  REQUESTING_KINDS,
  assertCanDeliver,
  assertCanPickup,
  minutesBetween,
  nearestAreaWarehouse,
  turnoverBucket,
  VISIBLE_TURNOVER_STATUSES,
  statusAfterTurnoverFulfill,
  turnoverLines,
  zoneChainUp,
  assertCanConfirm,
  assertCanAddLines,
  assertDifferenceReport,
  resolveDirtyLines,
  splitPickupResults,
  statusAfterTurnoverDeliver,
  closeOutcome,
  assertDeliverable,
  canFulfill,
  pendingQty,
  statusAfterFulfill,
  suggestSupply,
  supplySourceKind,
  zoneSubtree,
} from "./supply-request-rules";
import { dayRange } from "./day-range";
import { locationIdByCode, runSerializable, warehouseOfKind } from "./linen-locations";

/** Motivo del ajuste de salida por faltante al entregar un pedido por habitación. */
const DIFFERENCE_REASON = "Faltante en entrega de pedido";
const STATUSES = ["DRAFT", "SUBMITTED", "PARTIALLY_FULFILLED", "FULFILLED", "RECEIVED", "CANCELLED", "READY_FOR_PICKUP", "IN_TRANSIT"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const TURNOVER_INCLUDE = {
  room: { select: { id: true, number: true } },
  requestingWarehouse: { select: WAREHOUSE_SELECT },
  requestedBy: { select: { id: true, name: true } },
  carrier: { select: { id: true, name: true } },
  lines: { include: { product: { select: { id: true, code: true, name: true } } }, orderBy: { product: { code: "asc" as const } } },
} as const;

/**
 * Pedido de área (Etapa 2, pasos 5-7). La supervisora (o Spa/punto) pide; lavandería surte con un
 * traspaso IN_TRANSIT (FIFO) cuyo documento de origen es el pedido; el auxiliar de piso lo recibe
 * con el receive del traspaso (que suma `receivedQty`); la supervisora confirma con firma CONFIRMS.
 */
export class HotelSupplyRequestService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly transfers: HotelLinenTransferService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly deps: { notifications?: Notifier; rooms?: HotelRoomsService; roomPars?: HotelRoomParService; movements?: HotelMovementService } = {}
  ) {}

  private get roomPars(): HotelRoomParService {
    return (this.deps.roomPars ??= new HotelRoomParService(this.db, this.audit));
  }

  /**
   * Sugerido para una área: por cada producto LINEN del kit de las habitaciones de la zona del
   * almacén (con sus zonas descendientes), (salidas + ocupadas) × cantidad promedio del kit.
   * El promedio es sobre las habitaciones activas con kit activo; la habitación cuyo kit no lleva
   * el producto cuenta con 0. Se redondea hacia arriba. Sin zona -> lista vacía.
   */
  async suggestion(warehouseId: string, checkouts: number, occupied: number) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { ...WAREHOUSE_SELECT, zoneId: true } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    const base = {
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, kind: warehouse.kind },
      checkouts,
      occupied,
      formula: "(checkouts + occupied) x average kit quantity per room (rounded up)",
    };
    if (!warehouse.zoneId) return { ...base, rooms: 0, lines: [] };

    const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
    const zoneIds = [...zoneSubtree(zones, warehouse.zoneId)];
    const rooms = await this.db.hotelRoom.findMany({
      where: { active: true, zoneId: { in: zoneIds }, type: { kit: { is: { active: true } } } },
      select: {
        type: { select: { kit: { select: { lines: { where: { product: { kind: "LINEN" } }, select: { productId: true, quantity: true } } } } } },
      },
    });
    const suggested = suggestSupply(
      rooms.map((r) => ({ lines: (r.type.kit?.lines ?? []).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })) })),
      checkouts,
      occupied
    );
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: suggested.map((s) => s.productId) } },
      select: { id: true, code: true, name: true, size: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      ...base,
      rooms: rooms.length,
      lines: suggested
        .map((s) => ({ ...s, product: byId.get(s.productId) ?? null }))
        .sort((a, b) => (a.product?.code ?? "").localeCompare(b.product?.code ?? "")),
    };
  }

  async create(input: HotelSupplyRequestCreateInput, actorId: string) {
    const area = await this.db.hotelWarehouse.findUnique({ where: { id: input.requestingWarehouseId }, select: { id: true, kind: true, active: true } });
    if (!area) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (!area.active || !REQUESTING_KINDS.includes(area.kind)) throw new HttpError(422, "HOTEL_SUPPLY_AREA_INVALID");

    const ids = input.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_SUPPLY_LINES_DUPLICATE");
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true, kind: true, active: true, unit: { select: { whole: true } } },
    });
    if (products.length !== ids.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    for (const product of products) if (!product.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
    for (const line of input.lines) assertWholeQuantity(line.requestedQty, products.find((p) => p.id === line.productId)!.unit.whole);

    const sourceKind = supplySourceKind(products.map((p) => p.kind));
    if (sourceKind === "CENTRAL" && !input.sourceWarehouseId) throw new HttpError(422, "HOTEL_SUPPLY_SOURCE_REQUIRED");
    const source = await warehouseOfKind(this.db, sourceKind, input.sourceWarehouseId, "HOTEL_SUPPLY_SOURCE_INVALID");

    const created = await runSerializable(async (tx) => {
      const count = await tx.hotelSupplyRequest.count();
      return tx.hotelSupplyRequest.create({
        data: {
          folio: `PB-${String(count + 1).padStart(4, "0")}`,
          requestingWarehouseId: area.id,
          sourceWarehouseId: source.id,
          date: input.date ? dayRange(input.date).from : new Date(),
          shift: input.shift ?? null,
          checkouts: input.checkouts,
          occupied: input.occupied,
          notes: input.notes ?? null,
          requestedById: actorId,
          lines: { create: input.lines.map((l) => ({ productId: l.productId, requestedQty: l.requestedQty, notes: l.notes ?? null })) },
        },
      });
    }, this.db);
    await this.log("HOTEL_LINEN_REQUEST_CREATED", created.id, actorId, {}, { folio: created.folio, area: area.id, source: source.id, lines: input.lines.length });
    return this.get(created.id);
  }

  /** DRAFT -> SUBMITTED. */
  async submit(id: string, actorId: string) {
    const moved = await this.db.hotelSupplyRequest.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SUBMITTED" } });
    if (moved.count === 0) await this.assertExists(id, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    await this.log("HOTEL_LINEN_REQUEST_SUBMITTED", id, actorId, { status: "DRAFT" }, { status: "SUBMITTED" });
    await this.notifyLaundry(id, actorId);
    return this.get(id);
  }

  /** DRAFT o SUBMITTED sin surtir -> CANCELLED. */
  async cancel(id: string, actorId: string) {
    const moved = await this.db.hotelSupplyRequest.updateMany({ where: { id, status: { in: ["DRAFT", "SUBMITTED"] } }, data: { status: "CANCELLED" } });
    if (moved.count === 0) await this.assertExists(id, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    await this.log("HOTEL_LINEN_REQUEST_CANCELLED", id, actorId, {}, { status: "CANCELLED" });
    return this.get(id);
  }

  /**
   * Surte: crea el traspaso IN_TRANSIT (lavandería/CLEAN o central/GENERAL -> área/GENERAL, FIFO)
   * con el pedido como documento de origen. Lo no surtido queda pendiente (PARTIALLY_FULFILLED) y
   * admite otro surtido. `deliveredQty` de cada renglón es lo que se entrega ahora (no el acumulado).
   */
  async fulfill(id: string, input: HotelSupplyRequestFulfillInput, actorId: string) {
    const delivererId = input.cosignToken ? await this.signatures.resolveCosignUser(input.cosignToken) : actorId;
    const { folio, movement, from, to, turnover } = await runSerializable(async (tx) => {
      const request = await tx.hotelSupplyRequest.findUnique({
        where: { id },
        include: { lines: true, sourceWarehouse: { select: { id: true, kind: true } } },
      });
      if (!request) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
      if (!canFulfill(request.status)) throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");

      const byLine = new Map(input.lines.map((l) => [l.lineId, l.deliveredQty]));
      if (byLine.size !== input.lines.length || input.lines.some((l) => !request.lines.some((r) => r.id === l.lineId))) {
        throw new HttpError(422, "HOTEL_SUPPLY_LINES_MISMATCH");
      }
      const toDeliver = request.lines
        .map((line) => ({ line, now: byLine.get(line.id) ?? 0 }))
        .filter((x) => x.now > 0);
      if (toDeliver.length === 0) throw new HttpError(422, "HOTEL_SUPPLY_NOTHING_TO_DELIVER");
      const products = await tx.hotelProduct.findMany({
        where: { id: { in: toDeliver.map((x) => x.line.productId) } },
        select: { id: true, unit: { select: { whole: true } } },
      });
      for (const { line, now } of toDeliver) {
        assertDeliverable(pendingQty({ requestedQty: Number(line.requestedQty), deliveredQty: Number(line.deliveredQty) }), now);
        assertWholeQuantity(now, products.find((p) => p.id === line.productId)?.unit.whole ?? false);
      }

      const fromLocationId = await locationIdByCode(tx, request.sourceWarehouseId, request.sourceWarehouse.kind === "LAUNDRY" ? "CLEAN" : "GENERAL");
      const toLocationId = await locationIdByCode(tx, request.requestingWarehouseId, "GENERAL");
      const movement = await this.transfers.sendInTransaction(
        tx,
        {
          fromWarehouseId: request.sourceWarehouseId,
          toWarehouseId: request.requestingWarehouseId,
          notes: `Pedido ${request.folio}`,
          cosignToken: input.cosignToken,
          lines: toDeliver.map(({ line, now }) => ({ productId: line.productId, quantity: now, fromLocationId, toLocationId })),
        },
        actorId,
        delivererId,
        null,
        { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id }
      );

      for (const { line, now } of toDeliver) {
        await tx.hotelSupplyRequestLine.update({ where: { id: line.id }, data: { deliveredQty: { increment: now } } });
      }
      // Pedido por habitación: queda listo para que la auxiliar de piso lo recoja.
      const turnover = request.origin === "ROOM_TURNOVER";
      const status = turnover
        ? statusAfterTurnoverFulfill()
        : statusAfterFulfill(
            request.lines.map((l) => ({
              requestedQty: Number(l.requestedQty),
              deliveredQty: Number(l.deliveredQty) + (byLine.get(l.id) ?? 0),
            }))
          );
      await tx.hotelSupplyRequest.update({ where: { id }, data: { status, ...(turnover ? { readyAt: new Date() } : {}) } });
      return { folio: request.folio, movement, from: request.sourceWarehouseId, to: request.requestingWarehouseId, turnover };
    }, this.db);

    await this.transfers.logSent(movement, { fromWarehouseId: from, toWarehouseId: to }, actorId);
    await this.log("HOTEL_LINEN_REQUEST_FULFILLED", id, actorId, {}, { folio, transfer: movement.folio });
    if (turnover) await this.notifyReady(id, actorId);
    return this.get(id);
  }

  // ── Pedido por habitación (tablet) ─────────────────────────────────────────

  /** Habitación y su almacén de piso (el de su zona o el del ancestro más cercano). */
  async roomArea(roomId: string) {
    const room = await this.db.hotelRoom.findUnique({ where: { id: roomId }, select: { id: true, number: true, zoneId: true, status: true, active: true } });
    if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
    const chain = zoneChainUp(zones, room.zoneId);
    const warehouses = await this.db.hotelWarehouse.findMany({
      where: { kind: "ZONE", active: true, zoneId: { in: chain } },
      select: { ...WAREHOUSE_SELECT, zoneId: true },
    });
    const area = nearestAreaWarehouse(chain, warehouses);
    if (!area) throw new HttpError(422, "HOTEL_TURNOVER_AREA_NOT_FOUND");
    return { room, area: { id: area.id, code: area.code, name: area.name, kind: area.kind } };
  }

  /** Pedido por habitación aún abierto (si lo hay). */
  private openTurnover(db: PrismaClient | Prisma.TransactionClient, roomId: string) {
    return db.hotelSupplyRequest.findFirst({
      where: { roomId, origin: "ROOM_TURNOVER", status: { in: [...OPEN_TURNOVER_STATUSES] } },
      select: { id: true, folio: true, status: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Lista sugerida de blancos de la habitación (dotación × camas/baños) y el pedido abierto, si existe. */
  async turnoverSuggestion(roomId: string) {
    const { area } = await this.roomArea(roomId);
    const expected = await this.roomPars.expectedForRoom(roomId);
    return {
      room: expected.room,
      area,
      lines: expected.expected.map((e) => ({ product: e.product, quantity: e.quantity })),
      openRequest: await this.openTurnover(this.db, roomId),
    };
  }

  /**
   * "Se desocupó": crea y envía en un paso el pedido de la habitación. Si ya hay uno abierto lo devuelve
   * (`created: false`). La comprobación y el alta van en la misma transacción Serializable.
   */
  async roomTurnover(input: HotelRoomTurnoverInput, caller: Caller) {
    const { room, area } = await this.roomArea(input.roomId);
    const existing = await this.openTurnover(this.db, room.id);
    if (existing) return { created: false, request: await this.get(existing.id) };

    const suggested = input.lines ? [] : (await this.roomPars.expectedForRoom(room.id)).expected.map((e) => ({ productId: e.product.id, quantity: e.quantity }));
    const lines = turnoverLines(suggested, input.lines);
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true, kind: true, active: true, unit: { select: { whole: true } } },
    });
    if (products.length !== lines.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    for (const p of products) if (!p.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
    if (supplySourceKind(products.map((p) => p.kind)) !== "LAUNDRY") throw new HttpError(422, "HOTEL_SUPPLY_KINDS_INVALID");
    for (const line of lines) assertWholeQuantity(line.requestedQty, products.find((p) => p.id === line.productId)!.unit.whole);
    const source = await warehouseOfKind(this.db, "LAUNDRY", null, "HOTEL_SUPPLY_SOURCE_INVALID");

    const result = await runSerializable(async (tx) => {
      const open = await this.openTurnover(tx, room.id);
      if (open) return { created: false, id: open.id, folio: open.folio };
      const count = await tx.hotelSupplyRequest.count();
      const created = await tx.hotelSupplyRequest.create({
        data: {
          folio: `PB-${String(count + 1).padStart(4, "0")}`,
          requestingWarehouseId: area.id,
          sourceWarehouseId: source.id,
          origin: "ROOM_TURNOVER",
          roomId: room.id,
          status: "SUBMITTED",
          notes: input.notes ?? null,
          requestedById: caller.id,
          lines: { create: lines.map((l) => ({ productId: l.productId, requestedQty: l.requestedQty })) },
        },
        select: { id: true, folio: true },
      });
      return { created: true, id: created.id, folio: created.folio };
    }, this.db);

    if (result.created) {
      await this.log("HOTEL_LINEN_REQUEST_CREATED", result.id, caller.id, {}, { folio: result.folio, room: room.id, origin: "ROOM_TURNOVER", lines: lines.length });
      await this.notifyLaundry(result.id, caller.id);
      // Al desocuparse la habitación pasa a limpieza con el cambio de estado existente; si no aplica, el pedido sigue en pie.
      if (room.status === "OCCUPIED" && this.deps.rooms) {
        try {
          await this.deps.rooms.changeStatus(caller, room.id, { to: "CLEANING" });
        } catch {
          // El pedido ya quedó; el estado de la habitación se puede cambiar a mano.
        }
      }
    }
    return { created: result.created, request: await this.get(result.id) };
  }

  /** La auxiliar de piso recoge: atómico, el primero que lo toma se queda con el pedido. */
  async pickup(id: string, actorId: string) {
    const moved = await this.db.hotelSupplyRequest.updateMany({
      where: { id, origin: "ROOM_TURNOVER", status: "READY_FOR_PICKUP", carrierUserId: null },
      data: { status: "IN_TRANSIT", carrierUserId: actorId, pickedUpAt: new Date() },
    });
    if (moved.count === 0) {
      assertCanPickup(await this.header(id));
      throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    }
    await this.log("HOTEL_LINEN_REQUEST_PICKED_UP", id, actorId, { status: "READY_FOR_PICKUP" }, { status: "IN_TRANSIT", carrier: actorId });
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { requestedById: true, room: { select: { number: true } } } });
    if (r) {
      await notifyUsers(this.deps.notifications, [r.requestedById], {
        type: "HOTEL_LINEN_ORDER_PICKED_UP",
        title: `Blancos en camino a la habitación ${r.room?.number ?? ""}`.trim(),
      }, actorId);
    }
    return this.get(id);
  }

  /**
   * Recoger varias habitaciones en un viaje: cada una es atómica como `pickup`; las que otra auxiliar
   * ya tomó (o ya no están listas) no tumban el resto y se devuelven en `conflicts`. El área de cada
   * pedido la valida el controlador antes de llamar.
   */
  async pickupMany(ids: string[], actorId: string) {
    const unique = [...new Set(ids)];
    const pickedIds: string[] = [];
    for (const id of unique) {
      try {
        await this.pickup(id, actorId);
        pickedIds.push(id);
      } catch (err) {
        // Solo los conflictos de estado cuentan como "no se pudo tomar"; lo demás sí es un error.
        if (!(err instanceof HttpError) || err.status !== 409) throw err;
      }
    }
    return splitPickupResults(unique, pickedIds);
  }

  /**
   * Entregado en la habitación: quien lo recogió recibe el traspaso completo en el almacén de piso
   * (reusa `transfers.receive`) y el pedido se cierra solo (RECEIVED + `deliveredAt`); ya no pasa por
   * confirmación. Guarda el sucio recogido (por omisión lo entregado) de forma informativa.
   */
  async deliver(id: string, actorId: string, input: HotelSupplyDeliverInput = {}) {
    assertCanDeliver(await this.header(id), actorId);
    const movements = await this.db.hotelMovement.findMany({
      where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id, status: "IN_TRANSIT" },
      select: { id: true, lines: { select: { id: true, quantity: true } } },
    });
    for (const m of movements) {
      await this.transfers.receive(m.id, { lines: m.lines.map((l) => ({ lineId: l.id, receivedQuantity: Number(l.quantity) })) }, actorId);
    }
    const lines = await this.db.hotelSupplyRequestLine.findMany({ where: { requestId: id }, select: { id: true, productId: true, receivedQty: true } });
    const dirty = resolveDirtyLines(lines.map((l) => ({ productId: l.productId, deliveredQty: Number(l.receivedQty) })), input.dirtyLines);
    const dirtyOf = new Map(dirty.map((d) => [d.productId, d.quantity]));
    const now = new Date();
    const moved = await this.db.hotelSupplyRequest.updateMany({
      where: { id, status: "IN_TRANSIT", carrierUserId: actorId },
      data: { status: statusAfterTurnoverDeliver(), deliveredAt: now, dirtyCollectedAt: now },
    });
    if (moved.count === 0) throw new HttpError(409, "HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    for (const l of lines) {
      await this.db.hotelSupplyRequestLine.update({ where: { id: l.id }, data: { dirtyCollectedQty: dirtyOf.get(l.productId) ?? 0 } });
    }
    await this.log("HOTEL_LINEN_REQUEST_DELIVERED", id, actorId, { status: "IN_TRANSIT" }, { status: "RECEIVED", dirty: dirty.length });
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { requestedById: true, room: { select: { number: true } } } });
    if (r) {
      await notifyUsers(this.deps.notifications, [r.requestedById], {
        type: "HOTEL_LINEN_ORDER_DELIVERED",
        title: `Blancos entregados en la habitación ${r.room?.number ?? ""}`.trim(),
        detail: "Entregado",
      }, actorId);
    }
    return this.get(id);
  }

  /**
   * Extras de la supervisora: suma renglones a un pedido por habitación mientras siga SUBMITTED (lavandería
   * aún no surte). Si el producto ya está, suma a lo pedido. Solo blancos (LINEN), igual que el pedido.
   */
  async addLines(id: string, input: HotelSupplyAddLinesInput, actorId: string) {
    assertCanAddLines(await this.header(id));
    const ids = input.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_SUPPLY_LINES_DUPLICATE");
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, active: true, unit: { select: { whole: true } } } });
    if (products.length !== ids.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    for (const p of products) {
      if (!p.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
      if (p.kind !== "LINEN") throw new HttpError(422, "HOTEL_SUPPLY_KINDS_INVALID");
    }
    for (const l of input.lines) assertWholeQuantity(l.quantity, products.find((p) => p.id === l.productId)!.unit.whole);
    await runSerializable(async (tx) => {
      // Se vuelve a comprobar el estado dentro de la transacción: lavandería pudo surtir entre tanto.
      const current = await tx.hotelSupplyRequest.findUnique({ where: { id }, select: { status: true, origin: true } });
      if (!current) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
      assertCanAddLines(current);
      for (const l of input.lines) {
        await tx.hotelSupplyRequestLine.upsert({
          where: { requestId_productId: { requestId: id, productId: l.productId } },
          create: { requestId: id, productId: l.productId, requestedQty: l.quantity },
          update: { requestedQty: { increment: l.quantity } },
        });
      }
    }, this.db);
    await this.log("HOTEL_LINEN_REQUEST_LINES_ADDED", id, actorId, {}, { lines: input.lines.length });
    return this.get(id);
  }

  /**
   * Reportar diferencia (supervisora) sobre un pedido por habitación ya entregado: genera una baja de
   * inventario del almacén de piso (ADJUST_OUT, motivo "Faltante en entrega de pedido") con el flujo de
   * aprobación por umbral de los ajustes existentes, ligada al pedido (sourceDocType/sourceDocId), y avisa a
   * lavandería y a quien entregó.
   */
  async reportDifference(id: string, input: HotelSupplyDifferenceInput, actorId: string) {
    const request = await this.db.hotelSupplyRequest.findUnique({
      where: { id },
      select: {
        id: true, folio: true, status: true, origin: true, requestingWarehouseId: true, carrierUserId: true,
        room: { select: { number: true } },
        lines: { select: { productId: true, receivedQty: true } },
      },
    });
    if (!request) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
    const missing = assertDifferenceReport(
      request,
      request.lines.map((l) => ({ productId: l.productId, receivedQty: Number(l.receivedQty) })),
      input.lines,
      input.notes
    );
    const reason = await this.db.hotelReason.upsert({
      where: { kind_name: { kind: "ADJUSTMENT", name: DIFFERENCE_REASON } },
      update: {},
      create: { kind: "ADJUSTMENT", name: DIFFERENCE_REASON },
      select: { id: true },
    });
    const fromLocationId = await locationIdByCode(this.db, request.requestingWarehouseId, "GENERAL");
    const movementInput = {
      type: "ADJUST_OUT" as const,
      fromWarehouseId: request.requestingWarehouseId,
      reasonId: reason.id,
      notes: `${DIFFERENCE_REASON} ${request.folio}${request.room ? ` · hab. ${request.room.number}` : ""} · ${input.notes}`,
      sourceDocType: SUPPLY_REQUEST_DOC,
      sourceDocId: id,
      lines: missing.map((m) => ({ productId: m.productId, quantity: m.quantity, fromLocationId })),
    };
    assertMovementShape("ADJUST_OUT", movementInput);
    const movement = await (this.deps.movements ?? new HotelMovementService(this.db)).post(movementInput, actorId);
    await this.log("HOTEL_LINEN_REQUEST_DIFFERENCE_REPORTED", id, actorId, {}, { folio: request.folio, movement: movement.folio, status: movement.status, lines: missing.length });
    await notifyUsers(
      this.deps.notifications,
      [...(await userIdsByRoles(this.db, [LAUNDRY_ROLE])), ...(request.carrierUserId ? [request.carrierUserId] : [])],
      {
        type: "HOTEL_LINEN_ORDER_DIFFERENCE",
        title: `Diferencia en la entrega: habitación ${request.room?.number ?? request.folio}`.trim(),
        detail: input.notes,
      },
      actorId
    );
    return { request: await this.get(id), adjustment: { id: movement.id, folio: movement.folio, status: movement.status } };
  }

  /**
   * Cola por rol. Cada sección llega según el alcance del usuario (`null` = todo, `[]` = nada):
   * por surtir (lavandería), mis pedidos y entregados recientes (supervisión), por recoger y en camino (piso).
   */
  async queue(scope: { fulfill: string[] | null; request: string[] | null; carry: string[] | null }, userId: string) {
    const include = {
      room: { select: { id: true, number: true } },
      requestingWarehouse: { select: WAREHOUSE_SELECT },
      requestedBy: { select: { id: true, name: true } },
      carrier: { select: { id: true, name: true } },
      lines: { include: { product: { select: { id: true, code: true, name: true } } }, orderBy: { product: { code: "asc" as const } } },
    };
    const allowed = (ids: string[] | null) => ids === null || ids.length > 0;
    const inIds = (ids: string[] | null) => (ids ? { in: ids } : undefined);
    const take = 100;
    const [toFulfill, requested, toPickUp, carrying, delivered] = await Promise.all([
      allowed(scope.fulfill)
        ? this.db.hotelSupplyRequest.findMany({
            where: { status: { in: ["SUBMITTED", "PARTIALLY_FULFILLED"] }, sourceWarehouseId: inIds(scope.fulfill) },
            include,
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
      allowed(scope.request)
        ? this.db.hotelSupplyRequest.findMany({
            where: { status: { in: [...OPEN_TURNOVER_STATUSES] }, requestingWarehouseId: inIds(scope.request) },
            include,
            orderBy: { createdAt: "desc" },
            take,
          })
        : [],
      allowed(scope.carry)
        ? this.db.hotelSupplyRequest.findMany({
            where: { origin: "ROOM_TURNOVER", status: "READY_FOR_PICKUP", carrierUserId: null, requestingWarehouseId: inIds(scope.carry) },
            include,
            orderBy: { readyAt: "asc" },
            take,
          })
        : [],
      allowed(scope.carry)
        ? this.db.hotelSupplyRequest.findMany({
            where: { origin: "ROOM_TURNOVER", status: "IN_TRANSIT", carrierUserId: userId },
            include,
            orderBy: { pickedUpAt: "asc" },
            take,
          })
        : [],
      // Entregados (cerrados) en las últimas 12 h: la supervisora puede reportar diferencia sobre ellos.
      allowed(scope.request)
        ? this.db.hotelSupplyRequest.findMany({
            where: {
              origin: "ROOM_TURNOVER",
              status: "RECEIVED",
              deliveredAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
              requestingWarehouseId: inIds(scope.request),
            },
            include,
            orderBy: { deliveredAt: "desc" },
            take,
          })
        : [],
    ]);
    const now = new Date();
    type Row = (typeof toFulfill)[number];
    const item = (r: Row) => ({
      id: r.id,
      folio: r.folio,
      status: r.status,
      origin: r.origin,
      room: r.room,
      area: r.requestingWarehouse,
      requestedBy: r.requestedBy,
      carrier: r.carrier,
      createdAt: r.createdAt,
      readyAt: r.readyAt,
      pickedUpAt: r.pickedUpAt,
      deliveredAt: r.deliveredAt,
      ageMinutes: minutesBetween(r.createdAt, now),
      lines: r.lines.map((l) => ({
        id: l.id,
        product: l.product,
        requestedQty: Number(l.requestedQty),
        deliveredQty: Number(l.deliveredQty),
        receivedQty: Number(l.receivedQty),
        dirtyCollectedQty: l.dirtyCollectedQty,
        pendingQty: pendingQty({ requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }),
      })),
    });
    return { toFulfill: toFulfill.map(item), requested: requested.map(item), toPickUp: toPickUp.map(item), carrying: carrying.map(item), delivered: delivered.map(item) };
  }

  /**
   * Pedidos por habitación del día (cualquier estado visible, incluso confirmados) más los que
   * siguen abiertos de días anteriores. Mismo alcance por zona que `queue` (unión de los permisos).
   */
  async today(scope: { fulfill: string[] | null; request: string[] | null; carry: string[] | null }, range: { from: Date; to: Date }) {
    const rows = await this.db.hotelSupplyRequest.findMany({
      where: {
        AND: [
          this.scopeWhere(scope),
          { origin: "ROOM_TURNOVER", status: { in: [...VISIBLE_TURNOVER_STATUSES] } },
          { OR: [{ createdAt: { gte: range.from, lt: range.to } }, { status: { in: [...OPEN_TURNOVER_STATUSES] } }] },
        ],
      },
      include: TURNOVER_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return rows.map((r) => this.turnoverItem(r, new Date()));
  }

  /** Historial de pedidos por habitación de los últimos 60 días, paginado. */
  async history(scope: { fulfill: string[] | null; request: string[] | null; carry: string[] | null }, page: number, pageSize: number) {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const where = {
      AND: [
        this.scopeWhere(scope),
        { origin: "ROOM_TURNOVER" as const, status: { in: [...VISIBLE_TURNOVER_STATUSES] }, createdAt: { gte: since } },
      ],
    };
    const [total, rows] = await Promise.all([
      this.db.hotelSupplyRequest.count({ where }),
      this.db.hotelSupplyRequest.findMany({
        where,
        include: TURNOVER_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const now = new Date();
    return { data: rows.map((r) => this.turnoverItem(r, now)), total, page, pageSize };
  }

  /** Unión de los alcances: lavandería por almacén origen; supervisión y piso por almacén de área. */
  private scopeWhere(scope: { fulfill: string[] | null; request: string[] | null; carry: string[] | null }): Prisma.HotelSupplyRequestWhereInput {
    const clauses: Prisma.HotelSupplyRequestWhereInput[] = [];
    if (scope.fulfill === null || scope.request === null || scope.carry === null) return {};
    if (scope.fulfill.length > 0) clauses.push({ sourceWarehouseId: { in: scope.fulfill } });
    const area = [...new Set([...scope.request, ...scope.carry])];
    if (area.length > 0) clauses.push({ requestingWarehouseId: { in: area } });
    return { OR: clauses.length > 0 ? clauses : [{ id: "" }] };
  }

  private turnoverItem(
    r: Prisma.HotelSupplyRequestGetPayload<{ include: typeof TURNOVER_INCLUDE }>,
    now: Date
  ) {
    return {
      id: r.id,
      folio: r.folio,
      status: r.status,
      bucket: turnoverBucket(r.status),
      origin: r.origin,
      room: r.room,
      area: r.requestingWarehouse,
      requestedBy: r.requestedBy,
      carrier: r.carrier,
      createdAt: r.createdAt,
      readyAt: r.readyAt,
      pickedUpAt: r.pickedUpAt,
      deliveredAt: r.deliveredAt,
      updatedAt: r.updatedAt,
      ageMinutes: minutesBetween(r.createdAt, now),
      lines: r.lines.map((l) => ({
        id: l.id,
        product: l.product,
        requestedQty: Number(l.requestedQty),
        deliveredQty: Number(l.deliveredQty),
        receivedQty: Number(l.receivedQty),
        dirtyCollectedQty: l.dirtyCollectedQty,
        pendingQty: pendingQty({ requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }),
      })),
    };
  }

  /** Avisa a Lavandería que hay un pedido por surtir. */
  private async notifyLaundry(id: string, actorId: string) {
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { folio: true, room: { select: { number: true } }, requestingWarehouse: { select: { name: true } } } });
    if (!r) return;
    await notifyUsers(
      this.deps.notifications,
      await userIdsByRoles(this.db, [LAUNDRY_ROLE]),
      {
        type: "HOTEL_LINEN_ORDER_SUBMITTED",
        title: r.room ? `Pedido de blancos: habitación ${r.room.number}` : `Pedido de blancos ${r.folio}`,
        detail: r.requestingWarehouse.name,
      },
      actorId
    );
  }

  /** Avisa a las auxiliares de piso asignadas a la zona de la habitación que hay un pedido por recoger. */
  private async notifyReady(id: string, actorId: string) {
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { folio: true, room: { select: { number: true, zoneId: true } } } });
    if (!r?.room) return;
    const [zoneUsers, assistants] = await Promise.all([zoneSupervisorIds(this.db, r.room.zoneId), userIdsByRoles(this.db, [FLOOR_ASSISTANT_ROLE])]);
    const targets = zoneUsers.filter((u) => assistants.includes(u));
    await notifyUsers(this.deps.notifications, targets, {
      type: "HOTEL_LINEN_ORDER_READY",
      title: `Blancos listos para recoger: habitación ${r.room.number}`,
      detail: r.folio,
    }, actorId);
  }

  /** La supervisora del área confirma con firma CONFIRMS: FULFILLED (o PARTIALLY_FULFILLED sin tránsito, anotando pendientes) -> RECEIVED. */
  async confirm(id: string, actorId: string) {
    const { folio, previousStatus } = await runSerializable(async (tx) => {
      const request = await tx.hotelSupplyRequest.findUnique({ where: { id }, select: { id: true, folio: true, status: true, origin: true, notes: true, lines: { select: { requestedQty: true, deliveredQty: true, product: { select: { code: true } } } } } });
      if (!request) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
      const inTransit = await tx.hotelMovement.count({ where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id, status: "IN_TRANSIT" } });
      assertCanConfirm(request.status, inTransit, request.origin);
      await this.signatures.sign(SUPPLY_REQUEST_DOC, id, "CONFIRMS", actorId, "SESSION", tx);
      const outcome = closeOutcome(
        request.lines.map((l) => ({ code: l.product.code, requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }))
      );
      // Cierre con pendientes: se anotan en notes (sin columna nueva).
      const pendingNote = outcome.closedWithPending
        ? `Cerrado con pendientes: ${outcome.pending.map((p) => `${p.code} x${p.quantity}`).join(", ")}`
        : null;
      await tx.hotelSupplyRequest.update({
        where: { id },
        data: { status: outcome.status, ...(pendingNote ? { notes: request.notes ? `${request.notes}\n${pendingNote}` : pendingNote } : {}) },
      });
      return { folio: request.folio, previousStatus: request.status };
    }, this.db);
    await this.log("HOTEL_LINEN_REQUEST_CONFIRMED", id, actorId, { status: previousStatus }, { status: "RECEIVED", folio });
    return this.get(id);
  }

  /** Tabla server-side. Filtros: status, area, source, folio, date (rango). `visibleIds` null = todos. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const area = filterId(f, "area");
    const source = filterId(f, "source");
    const folio = filterText(f, "folio");
    const date = filterDateRange(f, "date");
    const where: Prisma.HotelSupplyRequestWhereInput = {
      ...(status ? { status: status as HotelSupplyRequestStatus } : {}),
      ...(area ? { requestingWarehouseId: area } : {}),
      ...(source ? { sourceWarehouseId: source } : {}),
      ...(folio ? { folio } : {}),
      ...(date ? { date } : {}),
      ...(visibleIds ? { OR: [{ requestingWarehouseId: { in: visibleIds } }, { sourceWarehouseId: { in: visibleIds } }] } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", date: "date", status: "status" }, [{ date: "desc" }]) as Prisma.HotelSupplyRequestOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelSupplyRequest.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          requestingWarehouse: { select: WAREHOUSE_SELECT },
          sourceWarehouse: { select: WAREHOUSE_SELECT },
          requestedBy: { select: { id: true, name: true } },
          lines: { select: { requestedQty: true, deliveredQty: true, receivedQty: true } },
        },
      }),
      this.db.hotelSupplyRequest.count({ where }),
    ]);
    return {
      total,
      data: rows.map((r) => {
        const sum = (key: "requestedQty" | "deliveredQty" | "receivedQty") => r.lines.reduce((s, l) => s + Number(l[key]), 0);
        return {
          id: r.id,
          folio: r.folio,
          date: r.date,
          shift: r.shift,
          status: r.status,
          area: r.requestingWarehouse,
          source: r.sourceWarehouse,
          requestedBy: r.requestedBy,
          lines: r.lines.length,
          requestedQty: sum("requestedQty"),
          deliveredQty: sum("deliveredQty"),
          receivedQty: sum("receivedQty"),
          pendingQty: r.lines.reduce((s, l) => s + pendingQty({ requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }), 0),
        };
      }),
    };
  }

  /** Detalle: renglones (solicitado/entregado/recibido/pendiente), traspasos ligados y firmas. */
  async get(id: string) {
    const r = await this.db.hotelSupplyRequest.findUnique({
      where: { id },
      include: {
        requestingWarehouse: { select: WAREHOUSE_SELECT },
        sourceWarehouse: { select: WAREHOUSE_SELECT },
        requestedBy: { select: { id: true, name: true } },
        room: { select: { id: true, number: true } },
        carrier: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } }, orderBy: { product: { code: "asc" } } },
      },
    });
    if (!r) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
    const [movements, adjustments, signatures] = await Promise.all([
      this.db.hotelMovement.findMany({ where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id, type: { not: "ADJUST_OUT" } }, select: { id: true }, orderBy: { createdAt: "asc" } }),
      // Ajustes de salida por diferencia reportada (faltante en la entrega).
      this.db.hotelMovement.findMany({
        where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id, type: "ADJUST_OUT" },
        select: { id: true, folio: true, status: true, notes: true, createdAt: true, lines: { select: { productId: true, quantity: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.signatures.list(SUPPLY_REQUEST_DOC, id),
    ]);
    const transfers = await Promise.all(movements.map((m) => this.transfers.get(m.id)));
    return {
      id: r.id,
      folio: r.folio,
      date: r.date,
      shift: r.shift,
      status: r.status,
      origin: r.origin,
      room: r.room,
      carrier: r.carrier,
      readyAt: r.readyAt,
      pickedUpAt: r.pickedUpAt,
      deliveredAt: r.deliveredAt,
      checkouts: r.checkouts,
      occupied: r.occupied,
      notes: r.notes,
      area: r.requestingWarehouse,
      source: r.sourceWarehouse,
      requestingWarehouseId: r.requestingWarehouseId,
      sourceWarehouseId: r.sourceWarehouseId,
      requestedBy: r.requestedBy,
      lines: r.lines.map((l) => ({
        id: l.id,
        product: l.product,
        requestedQty: Number(l.requestedQty),
        deliveredQty: Number(l.deliveredQty),
        receivedQty: Number(l.receivedQty),
        dirtyCollectedQty: l.dirtyCollectedQty,
        pendingQty: pendingQty({ requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }),
        notes: l.notes,
      })),
      transfers,
      differences: adjustments.map((a) => ({
        id: a.id,
        folio: a.folio,
        status: a.status,
        notes: a.notes,
        createdAt: a.createdAt,
        lines: a.lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
      })),
      dirtyCollectedAt: r.dirtyCollectedAt,
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Cabecera para decidir el alcance antes de operar. */
  async header(id: string) {
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { id: true, requestingWarehouseId: true, sourceWarehouseId: true, status: true, origin: true, carrierUserId: true } });
    if (!r) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
    return r;
  }

  private async assertExists(id: string, invalidStateCode: "HOTEL_SUPPLY_REQUEST_INVALID_STATE") {
    await this.header(id);
    throw new HttpError(409, invalidStateCode);
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({ action, entityType: "HotelSupplyRequest", entityId: id, userId: actorId, previousState, newState });
  }
}
