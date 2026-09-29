import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { localDateKey, resolveTimezoneWithConfig } from "@core/utils/timezone";
import {
  filterDayRange,
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderCreateInput,
  type PurchaseOrderReceiveInput,
  type PurchaseOrderUpdateInput,
} from "../models/dto/kitchen.dto";
import { round3 } from "./fefo";
import { KitchenStockService } from "./kitchen-stock.service";

type Tx = Prisma.TransactionClient;
type SysConfigReader = (key: string) => Promise<string | null>;

const RECEIVABLE: readonly string[] = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];
const num = (d: Prisma.Decimal) => d.toNumber();
const dec = (n: number) => new Prisma.Decimal(n.toFixed(3));
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

interface LineInput {
  itemId: string;
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
}

/** Une renglones repetidos del mismo artículo (suma la cantidad). */
const mergeLines = (lines: LineInput[]): LineInput[] => {
  const byItem = new Map<string, LineInput>();
  for (const line of lines) {
    const prev = byItem.get(line.itemId);
    if (prev) {
      prev.quantity = round3(prev.quantity + line.quantity);
      if (line.unitCost != null) prev.unitCost = line.unitCost;
      if (line.notes) prev.notes = line.notes;
    } else {
      byItem.set(line.itemId, { ...line });
    }
  }
  return [...byItem.values()];
};

/**
 * Órdenes de compra de cocina (F3). Se crean desde Reabastecimiento o a mano,
 * la aprueba gerencia y al recibir se genera el mismo `STOCK_IN` de v1 ligado a
 * la orden (`KitchenMovement.purchaseOrderId`). El sugerido resta lo que ya está
 * en tránsito para no pedir dos veces.
 */
export class PurchaseOrderService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly stock: KitchenStockService = new KitchenStockService(prismaClient),
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  // --- lecturas ---------------------------------------------------------------

  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.PurchaseOrderWhereInput = {
      number: filterText(f, "number"),
      supplierId: filterId(f, "supplierId"),
      status: filterEnum(f, "status", PURCHASE_ORDER_STATUSES),
      expectedAt: filterDayRange(f, "expectedAt"),
      createdBy: { name: filterText(f, "createdBy") },
    };
    const orderBy = orderByOf(
      params.sort,
      {
        number: "number",
        status: "status",
        expectedAt: "expectedAt",
        createdAt: "createdAt",
        supplier: (d: string) => ({ supplier: { name: d } }),
        createdBy: (d: string) => ({ createdBy: { name: d } }),
      },
      [{ createdAt: "desc" }]
    ) as Prisma.PurchaseOrderOrderByWithRelationInput[];
    const [orders, total] = await Promise.all([
      this.db.purchaseOrder.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          lines: { select: { quantity: true, unitCost: true, receivedQuantity: true } },
        },
      }),
      this.db.purchaseOrder.count({ where }),
    ]);
    return { data: orders.map((o) => this.serialize(o)), total };
  }

  async detail(id: string) {
    const order = await this.db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        lines: {
          include: { item: { select: { id: true, code: true, name: true, tracksExpiry: true, unit: { select: { id: true, code: true, name: true, whole: true } } } } },
          orderBy: { item: { name: "asc" } },
        },
        movements: {
          where: { type: "STOCK_IN" },
          orderBy: { date: "desc" },
          select: { id: true, date: true, reference: true, createdBy: { select: { name: true } } },
        },
      },
    });
    if (!order) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");

    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    const today = localDateKey(new Date(), timezone);
    const [availability, inTransit] = await Promise.all([
      this.stock.availability(order.lines.map((l) => l.itemId), today),
      this.stock.inTransitByItem(),
    ]);

    return {
      ...this.serialize(order),
      approvedBy: order.approvedBy,
      approvedAt: order.approvedAt?.toISOString() ?? null,
      sentAt: order.sentAt?.toISOString() ?? null,
      notes: order.notes,
      lines: order.lines.map((l) => {
        const quantity = num(l.quantity);
        const receivedQuantity = num(l.receivedQuantity);
        const available = availability.get(l.itemId)?.available ?? 0;
        const otherTransit = round3(Math.max(0, (inTransit.get(l.itemId) ?? 0) - (quantity - receivedQuantity)));
        return {
          id: l.id,
          item: l.item,
          quantity,
          unitCost: l.unitCost == null ? null : num(l.unitCost),
          receivedQuantity,
          pendingQuantity: round3(quantity - receivedQuantity),
          available,
          inTransit: otherTransit,
          notes: l.notes,
        };
      }),
      movements: order.movements.map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        reference: m.reference,
        createdBy: m.createdBy.name,
      })),
    };
  }

  // --- escrituras -------------------------------------------------------------

  async create(input: PurchaseOrderCreateInput, actorId: string) {
    await this.assertSupplier(input.supplierId);
    const lines = mergeLines(input.lines);
    if (lines.length === 0) throw new HttpError(400, "PURCHASE_ORDER_EMPTY");
    await this.assertItems(lines.map((l) => l.itemId));

    const created = await this.serializable(async (tx) => {
      const number = await this.nextNumber(tx);
      return tx.purchaseOrder.create({
        data: {
          number,
          supplierId: input.supplierId,
          expectedAt: input.expectedAt ? dateOfDay(input.expectedAt) : null,
          notes: input.notes ?? null,
          createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              itemId: l.itemId,
              quantity: dec(l.quantity),
              unitCost: l.unitCost == null ? null : new Prisma.Decimal(l.unitCost),
              notes: l.notes ?? null,
            })),
          },
        },
        select: { id: true, number: true },
      });
    });
    await this.audit?.({
      action: "PURCHASE_ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: created.id,
      userId: actorId,
      metadata: { number: created.number, lines: lines.length },
    });
    return this.detail(created.id);
  }

  async update(id: string, input: PurchaseOrderUpdateInput, actorId: string) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");
    if (order.status !== "DRAFT") throw new HttpError(409, "PURCHASE_ORDER_NOT_EDITABLE");
    if (input.supplierId && input.supplierId !== order.supplierId) await this.assertSupplier(input.supplierId);

    const lines = input.lines ? mergeLines(input.lines) : null;
    if (lines) {
      if (lines.length === 0) throw new HttpError(400, "PURCHASE_ORDER_EMPTY");
      await this.assertItems(lines.map((l) => l.itemId));
    }

    await this.db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          ...(input.expectedAt !== undefined ? { expectedAt: input.expectedAt ? dateOfDay(input.expectedAt) : null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        },
      });
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((l) => ({
            purchaseOrderId: id,
            itemId: l.itemId,
            quantity: dec(l.quantity),
            unitCost: l.unitCost == null ? null : new Prisma.Decimal(l.unitCost),
            notes: l.notes ?? null,
          })),
        });
      }
    });
    await this.audit?.({ action: "PURCHASE_ORDER_UPDATED", entityType: "PurchaseOrder", entityId: id, userId: actorId });
    return this.detail(id);
  }

  async approve(id: string, actorId: string) {
    const order = await this.requireStatus(id, ["DRAFT"]);
    await this.db.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() },
    });
    await this.audit?.({ action: "PURCHASE_ORDER_APPROVED", entityType: "PurchaseOrder", entityId: id, userId: actorId });
    return this.detail(id);
  }

  async send(id: string, actorId: string) {
    const order = await this.requireStatus(id, ["APPROVED"]);
    await this.db.purchaseOrder.update({ where: { id: order.id }, data: { status: "SENT", sentAt: new Date() } });
    await this.audit?.({ action: "PURCHASE_ORDER_SENT", entityType: "PurchaseOrder", entityId: id, userId: actorId });
    return this.detail(id);
  }

  async cancel(id: string, notes: string | null | undefined, actorId: string) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");
    if (order.status === "CANCELLED") return this.detail(id);
    if (order.status === "RECEIVED") throw new HttpError(409, "PURCHASE_ORDER_NOT_CANCELLABLE");
    if (order.lines.some((l) => num(l.receivedQuantity) > 0)) throw new HttpError(409, "PURCHASE_ORDER_HAS_RECEIPTS");
    await this.db.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", ...(notes ? { notes } : {}) },
    });
    await this.audit?.({ action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: id, userId: actorId });
    return this.detail(id);
  }

  /**
   * Recepción: registra un `STOCK_IN` con las líneas recibidas (lote/caducidad) y
   * actualiza lo recibido. Idempotente por `Idempotency-Key`: si el movimiento ya
   * existe para esta OC, se devuelve sin volver a contar.
   */
  async receive(id: string, input: PurchaseOrderReceiveInput, actorId: string, requestId?: string) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");
    if (!RECEIVABLE.includes(order.status)) throw new HttpError(409, "PURCHASE_ORDER_NOT_RECEIVABLE");

    if (requestId) {
      const previous = await this.db.kitchenMovement.findUnique({ where: { requestId }, select: { id: true, purchaseOrderId: true } });
      if (previous) {
        if (previous.purchaseOrderId !== id) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");
        return this.stock.movement(previous.id);
      }
    }

    const byId = new Map(order.lines.map((l) => [l.id, l]));
    const stockLines: Array<{ itemId: string; quantity: number; lotCode?: string; expiresAt: string | null; unitCost: number | null }> = [];
    const increments = new Map<string, number>();
    for (const line of input.lines) {
      const poLine = byId.get(line.lineId);
      if (!poLine) throw new HttpError(404, "PURCHASE_ORDER_LINE_NOT_FOUND");
      const pending = round3(num(poLine.quantity) - num(poLine.receivedQuantity));
      if (line.quantity > pending + 1e-6) {
        throw new HttpError(409, "PURCHASE_ORDER_OVER_RECEIPT", { item: poLine.itemId, pending });
      }
      stockLines.push({
        itemId: poLine.itemId,
        quantity: line.quantity,
        ...(line.lotCode ? { lotCode: line.lotCode } : {}),
        expiresAt: line.expiresAt ?? null,
        unitCost: line.unitCost ?? null,
      });
      increments.set(poLine.id, round3((increments.get(poLine.id) ?? 0) + line.quantity));
    }

    const movement = await this.stock.stockIn(
      {
        ...(input.date ? { date: input.date } : {}),
        reference: input.reference ?? order.number,
        notes: input.notes ?? null,
        supplierId: order.supplierId,
        lines: stockLines,
      },
      actorId,
      requestId,
      order.id
    );

    await this.db.$transaction(async (tx) => {
      for (const [lineId, quantity] of increments) {
        await tx.purchaseOrderLine.update({ where: { id: lineId }, data: { receivedQuantity: { increment: dec(quantity) } } });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const complete = lines.every((l) => num(l.receivedQuantity) >= num(l.quantity) - 1e-6);
      await tx.purchaseOrder.update({ where: { id }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    });

    await this.audit?.({
      action: "PURCHASE_ORDER_RECEIVED",
      entityType: "PurchaseOrder",
      entityId: id,
      userId: actorId,
      metadata: { lines: input.lines.length, movementId: movement.id },
    });
    return movement;
  }

  // --- internos ---------------------------------------------------------------

  private serialize(order: {
    id: string;
    number: string;
    status: string;
    expectedAt: Date | null;
    createdAt: Date;
    supplier: { id: string; name: string };
    createdBy: { id: string; name: string };
    lines: Array<{ quantity: Prisma.Decimal | number; unitCost: Prisma.Decimal | null; receivedQuantity: Prisma.Decimal | number }>;
  }) {
    const q = (v: Prisma.Decimal | number) => (typeof v === "number" ? v : num(v));
    const orderedUnits = order.lines.reduce((acc, l) => acc + q(l.quantity), 0);
    const receivedUnits = order.lines.reduce((acc, l) => acc + q(l.receivedQuantity), 0);
    const total = order.lines.reduce((acc, l) => acc + q(l.quantity) * (l.unitCost == null ? 0 : num(l.unitCost)), 0);
    return {
      id: order.id,
      number: order.number,
      supplier: order.supplier,
      status: order.status,
      expectedAt: dayOf(order.expectedAt),
      createdAt: order.createdAt.toISOString(),
      createdBy: order.createdBy,
      linesCount: order.lines.length,
      orderedUnits: round3(orderedUnits),
      receivedUnits: round3(receivedUnits),
      total: Math.round(total * 100) / 100,
    };
  }

  private async requireStatus(id: string, allowed: readonly string[]) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");
    if (!allowed.includes(order.status)) throw new HttpError(409, "PURCHASE_ORDER_INVALID_STATE", { status: order.status });
    return order;
  }

  private async assertSupplier(id: string) {
    const supplier = await this.db.supplier.findUnique({ where: { id } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    if (!supplier.active) throw new HttpError(409, "SUPPLIER_INACTIVE");
  }

  private async assertItems(ids: string[]) {
    const unique = [...new Set(ids)];
    const items = await this.db.kitchenItem.findMany({ where: { id: { in: unique } }, select: { id: true, active: true, name: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
      if (!item.active) throw new HttpError(409, "KITCHEN_ITEM_INACTIVE", { item: item.name });
    }
  }

  private async nextNumber(tx: Tx): Promise<string> {
    const count = await tx.purchaseOrder.count();
    let n = count + 1;
    for (;;) {
      const number = `OC-${String(n).padStart(4, "0")}`;
      const clash = await tx.purchaseOrder.findUnique({ where: { number }, select: { id: true } });
      if (!clash) return number;
      n += 1;
    }
  }

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === "P2034" || (err.code === "P2002" && ([] as string[]).concat((err.meta?.target as string[] | string) ?? []).includes("number")));
        if (!retryable) throw err;
        if (attempt >= 3) throw new HttpError(409, "CONCURRENT_UPDATE");
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
      }
    }
  }
}
