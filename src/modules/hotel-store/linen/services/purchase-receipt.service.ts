import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { filterEnum, filterId, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService, MovementInput } from "../../services/movement.service";
import type { HotelPurchaseHoldResolveInput, HotelPurchaseReceiptInput } from "../models/dto/purchase.dto";
import {
  RECEIVABLE_STATUSES,
  assertReceiptLine,
  assertToleranceAllowed,
  exceedsTolerance,
  holdDueDate,
  round3,
  statusAfterReceipt,
  type PurchaseOrderStatus,
} from "./purchase-rules";
import { PURCHASE_ORDER_DOC, num, readTolerancePct, userNames, userRef } from "./purchase-common";
import { locationIdByCode, runSerializable } from "./linen-locations";
import type { HotelPurchaseOrderService } from "./purchase-order.service";

const HOLD_STATUSES = ["OPEN", "RETURNED", "ACCEPTED"] as const;
const RETURN_REASON = "Devolución a proveedor";

type Tx = Prisma.TransactionClient;

/**
 * Recepción contra factura y OC (Etapa 1, pasos 2-3). Lo aceptado entra como INBOUND con lote nuevo al
 * almacén destino; lo apartado entra a HOLD con plazo de 5 días hábiles para que Compras gestione el
 * cambio o la devolución. Al resolver un apartado: aceptar lo mueve HOLD -> general; devolver lo saca.
 */
export class HotelPurchaseReceiptService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly orders: HotelPurchaseOrderService,
    private readonly audit?: AuditLogger
  ) {}

  async receive(orderId: string, input: HotelPurchaseReceiptInput, actorId: string, canApprove: boolean, requestKey?: string | null) {
    if (requestKey) {
      const existing = await this.db.hotelPurchaseReceipt.findUnique({ where: { requestKey }, select: { orderId: true } });
      if (existing) return this.orders.get(existing.orderId);
    }
    const order = await this.db.hotelPurchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order) throw new HttpError(404, "HOTEL_PO_NOT_FOUND");
    if (!RECEIVABLE_STATUSES.includes(order.status as PurchaseOrderStatus)) throw new HttpError(409, "HOTEL_PO_INVALID_STATE", { status: order.status });

    const ids = input.lines.map((l) => l.lineId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_PO_RECEIPT_LINES_INVALID");
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    if (ids.some((id) => !byId.has(id))) throw new HttpError(422, "HOTEL_PO_RECEIPT_LINES_INVALID");
    const lines = input.lines.filter((l) => l.receivedQty > 0 || l.acceptedQty > 0 || l.heldQty > 0);
    if (lines.length === 0) throw new HttpError(422, "HOTEL_PO_NOTHING_TO_RECEIVE");
    for (const l of lines) assertReceiptLine({ ...l, holdReason: l.holdReason });

    // Tolerancia (P3): lo acumulado = aceptado + apartado abierto + esta recepción.
    const openHolds = await this.db.hotelPurchaseHold.groupBy({
      by: ["receiptLineId"],
      where: { status: "OPEN", receiptLine: { orderLineId: { in: ids } } },
      _sum: { quantity: true },
    });
    const holdLines = await this.db.hotelPurchaseReceiptLine.findMany({ where: { id: { in: openHolds.map((h) => h.receiptLineId) } }, select: { id: true, orderLineId: true } });
    const heldOpenBy = new Map<string, number>();
    for (const h of openHolds) {
      const orderLineId = holdLines.find((l) => l.id === h.receiptLineId)?.orderLineId;
      if (orderLineId) heldOpenBy.set(orderLineId, (heldOpenBy.get(orderLineId) ?? 0) + num(h._sum.quantity));
    }
    const tolerance = await readTolerancePct(this.db);
    const exceeded = lines.some((l) => {
      const row = byId.get(l.lineId)!;
      const cumulative = num(row.receivedQuantity) + (heldOpenBy.get(l.lineId) ?? 0) + l.acceptedQty + l.heldQty;
      return exceedsTolerance(num(row.quantity), cumulative, tolerance);
    });
    assertToleranceAllowed(exceeded, input.notes, canApprove);

    const result = await runSerializable(async (tx) => {
      const holdLocation = lines.some((l) => l.heldQty > 0) ? await locationIdByCode(tx, order.warehouseId, "HOLD") : null;
      const acceptedLines = lines.filter((l) => l.acceptedQty > 0);
      const heldLines = lines.filter((l) => l.heldQty > 0);
      const note = `Factura ${input.invoiceNumber} · ${order.folio}${input.notes ? ` · ${input.notes}` : ""}`;

      const post = async (kind: "A" | "H", rows: typeof lines, qtyOf: (l: (typeof lines)[number]) => number, toLocationId: string | null) => {
        if (rows.length === 0) return null;
        const movementInput: MovementInput = {
          type: "INBOUND",
          warehouseId: order.warehouseId,
          notes: note,
          sourceDocType: PURCHASE_ORDER_DOC,
          sourceDocId: order.id,
          lines: rows.map((l) => ({ productId: byId.get(l.lineId)!.productId, quantity: qtyOf(l), unitCost: num(byId.get(l.lineId)!.unitCost), toLocationId })),
        };
        assertMovementShape("INBOUND", movementInput);
        return this.movements.applyInTransaction(tx, movementInput, actorId, requestKey ? `${requestKey}:${kind}` : null);
      };
      const accepted = await post("A", acceptedLines, (l) => l.acceptedQty, null);
      const held = await post("H", heldLines, (l) => l.heldQty, holdLocation);
      const lotOf = (movement: typeof accepted, productId: string) => movement?.lines.find((m) => m.productId === productId)?.lotId;

      const receipt = await tx.hotelPurchaseReceipt.create({
        data: {
          orderId: order.id,
          invoiceNumber: input.invoiceNumber,
          receivedById: actorId,
          movementId: accepted?.id ?? null,
          holdMovementId: held?.id ?? null,
          requestKey: requestKey ?? null,
          overToleranceById: exceeded ? actorId : null,
          notes: input.notes ?? null,
        },
      });
      const now = new Date();
      for (const l of lines) {
        const orderLine = byId.get(l.lineId)!;
        const receiptLot = l.acceptedQty > 0 ? lotOf(accepted, orderLine.productId) : l.heldQty > 0 ? lotOf(held, orderLine.productId) : null;
        const createdLine = await tx.hotelPurchaseReceiptLine.create({
          data: {
            receiptId: receipt.id,
            orderLineId: orderLine.id,
            productId: orderLine.productId,
            receivedQty: l.receivedQty,
            acceptedQty: l.acceptedQty,
            heldQty: l.heldQty,
            unitCost: orderLine.unitCost,
            holdReason: l.heldQty > 0 ? (l.holdReason ?? null) : null,
            lotId: receiptLot ?? null,
          },
        });
        if (l.heldQty > 0) {
          await tx.hotelPurchaseHold.create({
            data: {
              receiptLineId: createdLine.id,
              productId: orderLine.productId,
              warehouseId: order.warehouseId,
              lotId: lotOf(held, orderLine.productId)!,
              quantity: l.heldQty,
              unitCost: orderLine.unitCost,
              reason: l.holdReason!.trim(),
              dueAt: holdDueDate(now),
            },
          });
        }
        if (l.acceptedQty > 0) {
          await tx.hotelPurchaseOrderLine.update({ where: { id: orderLine.id }, data: { receivedQuantity: { increment: l.acceptedQty } } });
          // El costo de la recepción valoriza los consumos futuros.
          await tx.hotelProduct.update({ where: { id: orderLine.productId }, data: { lastCost: orderLine.unitCost } });
        }
      }
      await this.refreshOrderStatus(tx, order.id);
      return receipt;
    }, this.db).catch((err) => {
      if ((err as { code?: string })?.code === "P2002") throw new HttpError(409, "HOTEL_MOVEMENT_DUPLICATE");
      throw err;
    });

    await this.audit?.({
      action: "HOTEL_LINEN_PO_RECEIVED",
      entityType: "HotelPurchaseOrder",
      entityId: order.id,
      userId: actorId,
      newState: { receiptId: result.id, invoice: input.invoiceNumber, overTolerance: exceeded },
    });
    return this.orders.get(order.id);
  }

  /** Resuelve un apartado: ACCEPT lo mueve de HOLD a general; RETURN lo saca del sistema. */
  async resolveHold(id: string, input: HotelPurchaseHoldResolveInput, actorId: string) {
    await runSerializable(async (tx) => {
      const claimed = await tx.hotelPurchaseHold.updateMany({
        where: { id, status: "OPEN" },
        data: { status: input.action === "ACCEPT" ? "ACCEPTED" : "RETURNED", resolvedById: actorId, resolvedAt: new Date() },
      });
      if (claimed.count === 0) {
        const exists = await tx.hotelPurchaseHold.findUnique({ where: { id }, select: { id: true } });
        throw new HttpError(exists ? 409 : 404, exists ? "HOTEL_PO_HOLD_RESOLVED" : "HOTEL_PO_HOLD_NOT_FOUND");
      }
      const hold = await tx.hotelPurchaseHold.findUniqueOrThrow({ where: { id }, include: { receiptLine: { include: { receipt: true } } } });
      const holdLocation = await locationIdByCode(tx, hold.warehouseId, "HOLD");
      const quantity = num(hold.quantity);
      let movementId: string;
      if (input.action === "ACCEPT") {
        const target = await tx.hotelLocation.findFirst({ where: { warehouseId: hold.warehouseId, isDefault: true, active: true }, select: { id: true } });
        if (!target) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE");
        const movementInput: MovementInput = {
          type: "TRANSFER",
          fromWarehouseId: hold.warehouseId,
          warehouseId: hold.warehouseId,
          notes: `Apartado aceptado · ${hold.reason}`,
          sourceDocType: PURCHASE_ORDER_DOC,
          sourceDocId: hold.receiptLine.receipt.orderId,
          lines: [{ productId: hold.productId, quantity, lotId: hold.lotId, fromLocationId: holdLocation, toLocationId: target.id, unitCost: num(hold.unitCost) }],
        };
        assertMovementShape("TRANSFER", movementInput);
        movementId = (await this.movements.applyInTransaction(tx, movementInput, actorId, null)).id;
        await tx.hotelPurchaseOrderLine.update({ where: { id: hold.receiptLine.orderLineId }, data: { receivedQuantity: { increment: quantity } } });
        await this.refreshOrderStatus(tx, hold.receiptLine.receipt.orderId);
      } else {
        const reason = await tx.hotelReason.upsert({
          where: { kind_name: { kind: "ADJUSTMENT", name: RETURN_REASON } },
          update: {},
          create: { kind: "ADJUSTMENT", name: RETURN_REASON },
        });
        const movementInput: MovementInput = {
          type: "ADJUST_OUT",
          fromWarehouseId: hold.warehouseId,
          reasonId: reason.id,
          notes: `Devolución al proveedor · ${hold.reason}${input.notes ? ` · ${input.notes}` : ""}`,
          skipApproval: true,
          sourceDocType: PURCHASE_ORDER_DOC,
          sourceDocId: hold.receiptLine.receipt.orderId,
          lines: [{ productId: hold.productId, quantity, lotId: hold.lotId, fromLocationId: holdLocation }],
        };
        assertMovementShape("ADJUST_OUT", movementInput);
        movementId = (await this.movements.applyInTransaction(tx, movementInput, actorId, null)).id;
      }
      await tx.hotelPurchaseHold.update({ where: { id }, data: { resolutionMovementId: movementId } });
    }, this.db);
    await this.audit?.({
      action: input.action === "ACCEPT" ? "HOTEL_LINEN_PO_HOLD_ACCEPTED" : "HOTEL_LINEN_PO_HOLD_RETURNED",
      entityType: "HotelPurchaseHold",
      entityId: id,
      userId: actorId,
      newState: { action: input.action },
    });
    return this.getHold(id);
  }

  async getHold(id: string) {
    const rows = await this.holdRows({ id });
    if (rows.length === 0) throw new HttpError(404, "HOTEL_PO_HOLD_NOT_FOUND");
    return rows[0];
  }

  async holdTable(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.HotelPurchaseHoldWhereInput = {
      status: filterEnum(f, "status", HOLD_STATUSES),
      productId: filterId(f, "productId"),
    };
    const orderBy = orderByOf(params.sort, { dueAt: "dueAt", createdAt: "createdAt", status: "status" }, [{ dueAt: "asc" }]) as Prisma.HotelPurchaseHoldOrderByWithRelationInput[];
    const [data, total] = await Promise.all([
      this.holdRows(where, orderBy, (params.page - 1) * params.limit, params.limit),
      this.db.hotelPurchaseHold.count({ where }),
    ]);
    return { data, total };
  }

  private async holdRows(where: Prisma.HotelPurchaseHoldWhereInput, orderBy: Prisma.HotelPurchaseHoldOrderByWithRelationInput[] = [{ dueAt: "asc" }], skip = 0, take = 1) {
    const rows = await this.db.hotelPurchaseHold.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        product: { select: { id: true, code: true, name: true, size: true } },
        receiptLine: { include: { receipt: { include: { order: { select: { id: true, folio: true, supplier: { select: { id: true, name: true } } } } } } } },
      },
    });
    const names = await userNames(this.db, rows.map((r) => r.resolvedById));
    const now = Date.now();
    return rows.map((h) => ({
      id: h.id,
      status: h.status,
      product: h.product,
      quantity: num(h.quantity),
      unitCost: num(h.unitCost),
      reason: h.reason,
      dueAt: h.dueAt.toISOString(),
      overdue: h.status === "OPEN" && h.dueAt.getTime() < now,
      createdAt: h.createdAt.toISOString(),
      invoiceNumber: h.receiptLine.receipt.invoiceNumber,
      order: h.receiptLine.receipt.order,
      resolvedBy: userRef(names, h.resolvedById),
      resolvedAt: h.resolvedAt?.toISOString() ?? null,
    }));
  }

  /** Recalcula el estado de la OC según lo aceptado; las cerradas o canceladas no se tocan. */
  private async refreshOrderStatus(tx: Tx, orderId: string) {
    const order = await tx.hotelPurchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    if (!RECEIVABLE_STATUSES.includes(order.status as PurchaseOrderStatus)) return;
    const status = statusAfterReceipt(order.lines.map((l) => ({ quantity: round3(num(l.quantity)), receivedQuantity: round3(num(l.receivedQuantity)) })));
    if (status !== order.status) await tx.hotelPurchaseOrder.update({ where: { id: orderId }, data: { status } });
  }
}
