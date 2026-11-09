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
import type { HotelSupplyRequestCreateInput, HotelSupplyRequestFulfillInput } from "../models/dto/laundry.dto";
import {
  REQUESTING_KINDS,
  assertCanConfirm,
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

const STATUSES = ["DRAFT", "SUBMITTED", "PARTIALLY_FULFILLED", "FULFILLED", "RECEIVED", "CANCELLED"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;

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
    private readonly audit?: AuditLogger
  ) {}

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
    const { folio, movement, from, to } = await runSerializable(async (tx) => {
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
      const status = statusAfterFulfill(
        request.lines.map((l) => ({
          requestedQty: Number(l.requestedQty),
          deliveredQty: Number(l.deliveredQty) + (byLine.get(l.id) ?? 0),
        }))
      );
      await tx.hotelSupplyRequest.update({ where: { id }, data: { status } });
      return { folio: request.folio, movement, from: request.sourceWarehouseId, to: request.requestingWarehouseId };
    }, this.db);

    await this.transfers.logSent(movement, { fromWarehouseId: from, toWarehouseId: to }, actorId);
    await this.log("HOTEL_LINEN_REQUEST_FULFILLED", id, actorId, {}, { folio, transfer: movement.folio });
    return this.get(id);
  }

  /** La supervisora del área confirma con firma CONFIRMS: FULFILLED (o PARTIALLY_FULFILLED sin tránsito, anotando pendientes) -> RECEIVED. */
  async confirm(id: string, actorId: string) {
    const { folio, previousStatus } = await runSerializable(async (tx) => {
      const request = await tx.hotelSupplyRequest.findUnique({ where: { id }, select: { id: true, folio: true, status: true, notes: true, lines: { select: { requestedQty: true, deliveredQty: true, product: { select: { code: true } } } } } });
      if (!request) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
      const inTransit = await tx.hotelMovement.count({ where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id, status: "IN_TRANSIT" } });
      assertCanConfirm(request.status, inTransit);
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
        lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } }, orderBy: { product: { code: "asc" } } },
      },
    });
    if (!r) throw new HttpError(404, "HOTEL_SUPPLY_REQUEST_NOT_FOUND");
    const [movements, signatures] = await Promise.all([
      this.db.hotelMovement.findMany({ where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: id }, select: { id: true }, orderBy: { createdAt: "asc" } }),
      this.signatures.list(SUPPLY_REQUEST_DOC, id),
    ]);
    const transfers = await Promise.all(movements.map((m) => this.transfers.get(m.id)));
    return {
      id: r.id,
      folio: r.folio,
      date: r.date,
      shift: r.shift,
      status: r.status,
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
        pendingQty: pendingQty({ requestedQty: Number(l.requestedQty), deliveredQty: Number(l.deliveredQty) }),
        notes: l.notes,
      })),
      transfers,
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Cabecera para decidir el alcance antes de operar. */
  async header(id: string) {
    const r = await this.db.hotelSupplyRequest.findUnique({ where: { id }, select: { id: true, requestingWarehouseId: true, sourceWarehouseId: true, status: true } });
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
