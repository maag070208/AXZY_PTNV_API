import { Prisma, type HotelMovementStatus, type PrismaClient } from "@prisma/client";
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
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelSignatureService } from "./signature.service";
import type { HotelTransferReceiveInput, HotelTransferSendInput } from "../models/dto/transfer.dto";
import {
  assertCanCancelTransfer,
  assertDifferentUsers,
  assertReceivedQuantity,
  lineShortfall,
  receptionStatus,
} from "./transfer-rules";

export const TRANSFER_DOC = "HOTEL_TRANSFER";
/** Documento de origen de los traspasos que surten un pedido de área. */
export const SUPPLY_REQUEST_DOC = "HOTEL_SUPPLY_REQUEST";
/** Documentos de origen que esta tabla trata como traspasos con doble firma. */
const TRANSFER_DOCS = [TRANSFER_DOC, SUPPLY_REQUEST_DOC];

/** Variantes de un traspaso: tipo del movimiento y documento de origen. */
export interface TransferOptions {
  type?: "TRANSFER" | "FIRST_WASH" | "SUPPLIER_RETURN" | "LOAN_OUT" | "LOAN_RETURN";
  sourceDocType?: string;
  sourceDocId?: string | null;
}
const MAX_ATTEMPTS = 3;

const TABLE_STATUSES = ["IN_TRANSIT", "ACTIVE", "RECEIVED_WITH_DIFFERENCE", "CANCELLED"] as const;

const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;

/**
 * Traspasos de blancos con doble firma (D6). Al enviar sale del origen (IN_TRANSIT) y firma quien
 * entrega; al recibir entra al destino lo contado y firma quien recibe. Lo no recibido no vuelve
 * al stock: queda como faltante en la línea (`quantity - receivedQuantity`).
 */
export class HotelLinenTransferService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger
  ) {}

  /** Envía: saca del origen de inmediato y firma DELIVERS (el usuario de la sesión, o el del cosignToken). */
  async send(input: HotelTransferSendInput, actorId: string, requestId?: string | null, options: TransferOptions = {}) {
    if (requestId) {
      const existing = await this.db.hotelMovement.findUnique({ where: { requestId }, select: { id: true } });
      if (existing) return this.get(existing.id);
    }
    const delivererId = input.cosignToken ? await this.signatures.resolveCosignUser(input.cosignToken) : actorId;
    const movement = await this.serializable(
      (tx) => this.sendInTransaction(tx, input, actorId, delivererId, requestId ?? null, options),
      requestId
    );
    await this.logSent(movement, input, actorId);
    return this.get(movement.id);
  }

  /**
   * Envío dentro de la transacción de quien llama (p. ej. surtir un pedido de área, que además
   * actualiza el pedido). `delivererId` es quien firma la entrega.
   */
  async sendInTransaction(
    tx: Prisma.TransactionClient,
    input: HotelTransferSendInput,
    actorId: string,
    delivererId: string,
    requestId: string | null,
    options: TransferOptions = {}
  ) {
    if (input.fromWarehouseId === input.toWarehouseId) throw new HttpError(422, "HOTEL_MOVEMENT_SAME_WAREHOUSE");
    const type = options.type ?? "TRANSFER";
    const movementInput = {
      type,
      inTransit: true,
      sourceDocType: options.sourceDocType ?? TRANSFER_DOC,
      sourceDocId: options.sourceDocId ?? null,
      fromWarehouseId: input.fromWarehouseId,
      warehouseId: input.toWarehouseId,
      notes: input.notes ?? null,
      lines: input.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        lotId: l.lotId ?? null,
        fromLocationId: l.fromLocationId ?? null,
        toLocationId: l.toLocationId ?? null,
      })),
    };
    assertMovementShape(type, movementInput);
    const method = input.cosignToken ? "PASSWORD" : "SESSION";
    const created = await this.movements.applyInTransaction(tx, movementInput, actorId, requestId);
    // Las firmas de todo traspaso cuelgan del mismo documento (HOTEL_TRANSFER), sea cual sea su origen.
    await this.signatures.sign(TRANSFER_DOC, created.id, "DELIVERS", delivererId, method, tx);
    return created;
  }

  /** Auditoría del envío (después de confirmar la transacción). */
  async logSent(
    movement: { id: string; folio: string; lines: unknown[] },
    input: { fromWarehouseId: string; toWarehouseId: string },
    actorId: string
  ) {
    await this.log("HOTEL_LINEN_TRANSFER_SENT", movement.id, actorId, {}, {
      folio: movement.folio,
      from: input.fromWarehouseId,
      to: input.toWarehouseId,
      lines: movement.lines.length,
    });
  }

  /** Recibe contando: entra al destino lo contado, con el mismo lote. Quien recibe no es quien envió. */
  async receive(id: string, input: HotelTransferReceiveInput, actorId: string) {
    const receiverId = input.cosignToken ? await this.signatures.resolveCosignUser(input.cosignToken) : actorId;
    const method = input.cosignToken ? "PASSWORD" : "SESSION";

    const result = await this.serializable(async (tx) => {
      const movement = await this.findTransfer(tx, id);
      if (movement.status !== "IN_TRANSIT") throw new HttpError(409, "HOTEL_TRANSFER_NOT_IN_TRANSIT");
      await this.assertReceiverIsNotSender(tx, movement, receiverId);

      const byLine = new Map(input.lines.map((l) => [l.lineId, l.receivedQuantity]));
      if (byLine.size !== input.lines.length || byLine.size !== movement.lines.length ||
          movement.lines.some((l) => !byLine.has(l.id))) {
        throw new HttpError(422, "HOTEL_TRANSFER_LINES_MISMATCH");
      }

      const products = await tx.hotelProduct.findMany({
        where: { id: { in: movement.lines.map((l) => l.productId) } },
        select: { id: true, unit: { select: { whole: true } } },
      });
      const wholeOf = new Map(products.map((p) => [p.id, p.unit.whole]));

      const counted: Array<{ quantity: number; receivedQuantity: number }> = [];
      for (const line of movement.lines) {
        const sent = Number(line.quantity);
        const received = byLine.get(line.id)!;
        assertReceivedQuantity(sent, received);
        assertWholeQuantity(received, wholeOf.get(line.productId) ?? false);
        if (received > 0) {
          await this.movements.move(tx, line.productId, movement.warehouseId!, line.toLocationId!, line.lotId, received);
        }
        await tx.hotelMovementLine.update({ where: { id: line.id }, data: { receivedQuantity: received } });
        // Si surtía un pedido de área, lo recibido suma al renglón del pedido (varias líneas por lote suman).
        if (movement.sourceDocType === SUPPLY_REQUEST_DOC && movement.sourceDocId && received > 0) {
          await tx.hotelSupplyRequestLine.updateMany({
            where: { requestId: movement.sourceDocId, productId: line.productId },
            data: { receivedQty: { increment: received } },
          });
        }
        counted.push({ quantity: sent, receivedQuantity: received });
      }

      const status = receptionStatus(counted);
      await tx.hotelMovement.update({
        where: { id },
        data: { status, receivedById: receiverId, receivedAt: new Date(), receiveNotes: input.notes ?? null },
      });
      await this.signatures.sign(TRANSFER_DOC, id, "RECEIVES", receiverId, method, tx);
      return { status, folio: movement.folio, shortfall: counted.reduce((s, l) => s + lineShortfall(l.quantity, l.receivedQuantity), 0) };
    });
    await this.log("HOTEL_LINEN_TRANSFER_RECEIVED", id, actorId, { status: "IN_TRANSIT" }, {
      status: result.status,
      folio: result.folio,
      receivedBy: receiverId,
      shortfall: result.shortfall,
    });
    return this.get(id);
  }

  /** Cancela un traspaso en tránsito: lo enviado regresa al origen (mismo lote). */
  async cancel(id: string, actorId: string, canApprove: boolean) {
    const folio = await this.serializable(async (tx) => {
      const movement = await this.findTransfer(tx, id);
      const senders = await this.senderIds(tx, movement);
      assertCanCancelTransfer(movement.status, actorId, senders, canApprove);
      for (const line of movement.lines) {
        await this.movements.move(tx, line.productId, movement.fromWarehouseId!, line.fromLocationId!, line.lotId, Number(line.quantity));
      }
      await tx.hotelMovement.update({
        where: { id },
        data: { status: "CANCELLED", approvedById: actorId, approvedAt: new Date() },
      });
      return movement.folio;
    });
    await this.log("HOTEL_LINEN_TRANSFER_CANCELLED", id, actorId, { status: "IN_TRANSIT" }, { status: "CANCELLED", folio });
    return this.get(id);
  }

  /**
   * Tabla server-side. Filtros: status, from, to, date (rango), folio. `inbox` = por recibir
   * (IN_TRANSIT con destino en `receivableIds`). `visibleIds` null = todos.
   */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null, receivableIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", TABLE_STATUSES);
    const from = filterId(f, "from");
    const to = filterId(f, "to");
    const inbox = f.inbox === true || f.inbox === "true";
    const where: Prisma.HotelMovementWhereInput = {
      sourceDocType: { in: TRANSFER_DOCS },
      ...(status ? { status } : {}),
      ...(from ? { fromWarehouseId: from } : {}),
      ...(to ? { warehouseId: to } : {}),
      ...(filterDateRange(f, "date") ? { date: filterDateRange(f, "date") } : {}),
      ...(filterText(f, "folio") ? { folio: filterText(f, "folio") } : {}),
      AND: [
        ...(visibleIds ? [{ OR: [{ fromWarehouseId: { in: visibleIds } }, { warehouseId: { in: visibleIds } }] }] : []),
        ...(inbox
          ? [{ status: "IN_TRANSIT" as HotelMovementStatus }, ...(receivableIds ? [{ warehouseId: { in: receivableIds } }] : [])]
          : []),
      ],
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", date: "date", status: "status" }, [{ date: "desc" }]) as Prisma.HotelMovementOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelMovement.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          fromWarehouse: { select: WAREHOUSE_SELECT },
          warehouse: { select: WAREHOUSE_SELECT },
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
          lines: { select: { quantity: true, receivedQuantity: true } },
        },
      }),
      this.db.hotelMovement.count({ where }),
    ]);
    return {
      total,
      data: rows.map((m) => {
        const sent = m.lines.reduce((s, l) => s + Number(l.quantity), 0);
        const received = m.receivedAt ? m.lines.reduce((s, l) => s + Number(l.receivedQuantity ?? 0), 0) : null;
        return {
          id: m.id,
          folio: m.folio,
          date: m.date,
          status: m.status,
          type: m.type,
          from: m.fromWarehouse,
          to: m.warehouse,
          sentBy: m.createdBy,
          receivedBy: m.receivedBy,
          receivedAt: m.receivedAt,
          lines: m.lines.length,
          sentQuantity: sent,
          receivedQuantity: received,
          difference: received === null ? null : sent - received,
        };
      }),
    };
  }

  /** Detalle: líneas con lote, firmas y diferencia. */
  async get(id: string) {
    const m = await this.db.hotelMovement.findUnique({
      where: { id },
      include: {
        fromWarehouse: { select: WAREHOUSE_SELECT },
        warehouse: { select: WAREHOUSE_SELECT },
        createdBy: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, code: true, name: true, size: true } },
            lot: { select: { id: true, code: true, receivedAt: true } },
            fromLocation: { select: { id: true, code: true } },
            toLocation: { select: { id: true, code: true } },
          },
        },
      },
    });
    if (!m || !m.sourceDocType || !TRANSFER_DOCS.includes(m.sourceDocType)) throw new HttpError(404, "HOTEL_TRANSFER_NOT_FOUND");
    const signatures = await this.signatures.list(TRANSFER_DOC, id);
    const lines = m.lines.map((l) => {
      const sent = Number(l.quantity);
      const received = l.receivedQuantity === null ? null : Number(l.receivedQuantity);
      return {
        id: l.id,
        product: l.product,
        lot: l.lot,
        fromLocation: l.fromLocation,
        toLocation: l.toLocation,
        quantity: sent,
        receivedQuantity: received,
        difference: received === null ? null : lineShortfall(sent, received),
      };
    });
    return {
      id: m.id,
      folio: m.folio,
      date: m.date,
      status: m.status,
      type: m.type,
      sourceDocType: m.sourceDocType,
      sourceDocId: m.sourceDocId,
      from: m.fromWarehouse,
      to: m.warehouse,
      fromWarehouseId: m.fromWarehouseId,
      warehouseId: m.warehouseId,
      notes: m.notes,
      receiveNotes: m.receiveNotes,
      sentBy: m.createdBy,
      receivedBy: m.receivedBy,
      receivedAt: m.receivedAt,
      lines,
      difference: m.receivedAt ? lines.reduce((s, l) => s + (l.difference ?? 0), 0) : null,
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Quienes enviaron: quien creó el traspaso y quien firmó la entrega. */
  private async senderIds(tx: Prisma.TransactionClient, movement: { id: string; createdById: string }) {
    const delivers = await tx.hotelSignature.findFirst({
      where: { docType: TRANSFER_DOC, docId: movement.id, role: "DELIVERS" },
      select: { userId: true },
    });
    return [movement.createdById, delivers?.userId];
  }

  private async assertReceiverIsNotSender(tx: Prisma.TransactionClient, movement: { id: string; createdById: string }, receiverId: string) {
    assertDifferentUsers(await this.senderIds(tx, movement), receiverId);
  }

  private async findTransfer(tx: Prisma.TransactionClient, id: string) {
    const movement = await tx.hotelMovement.findUnique({ where: { id }, include: { lines: true } });
    if (!movement || !movement.sourceDocType || !TRANSFER_DOCS.includes(movement.sourceDocType)) throw new HttpError(404, "HOTEL_TRANSFER_NOT_FOUND");
    return movement;
  }

  private async serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, requestId?: string | null): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2034" && attempt < MAX_ATTEMPTS) continue;
        if (code === "P2002" && requestId) {
          // Misma llave de idempotencia en paralelo: gana la primera petición.
          const existing = await this.db.hotelMovement.findUnique({ where: { requestId }, include: { lines: true } });
          if (existing) return existing as unknown as T;
        }
        throw err;
      }
    }
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({ action, entityType: "HotelMovement", entityId: id, userId: actorId, previousState, newState });
  }
}
