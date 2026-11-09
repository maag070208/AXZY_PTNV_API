import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { filterDayRange, filterEnum, filterId, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelPurchaseCloseInput, HotelPurchaseOrderCreateInput, HotelPurchaseOrderUpdateInput } from "../models/dto/purchase.dto";
import { assertWholeQuantity } from "../../services/hotel-catalog-rules";
import { assertCanApprove, assertCanCancel, assertCanClose, lineAmounts, orderTotals, pendingOfLine } from "./purchase-rules";
import { PURCHASE_ORDER_SEQ, nextFolio, num, receivingWarehouse, userNames, userRef } from "./purchase-common";
import { runSerializable } from "./linen-locations";

const STATUSES = ["DRAFT", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

const ORDER_INCLUDE = {
  supplier: { select: { id: true, name: true, legalName: true, rfc: true, email: true, phone: true } },
  lines: {
    include: {
      product: { select: { id: true, code: true, name: true, size: true, unit: { select: { name: true } } } },
    },
    orderBy: { product: { code: "asc" } },
  },
  receipts: {
    orderBy: { date: "desc" },
    include: { lines: { include: { lot: { select: { code: true } } } } },
  },
} satisfies Prisma.HotelPurchaseOrderInclude;

type OrderRow = Prisma.HotelPurchaseOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Órdenes de compra del hotel (M7, serie OC-H-0001): borrador -> aprobada -> recepción parcial -> recibida,
 * con cierre con faltante o cancelación. Costos antes de IVA; cada línea guarda la fotografía de la tasa.
 */
export class HotelPurchaseOrderService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  // ── Lecturas ──────────────────────────────────────────────────────────────

  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.HotelPurchaseOrderWhereInput = {
      folio: filterText(f, "folio"),
      status: filterEnum(f, "status", STATUSES),
      supplierId: filterId(f, "supplierId"),
      createdAt: filterDayRange(f, "createdAt"),
    };
    const orderBy = orderByOf(
      params.sort,
      { folio: "folio", status: "status", createdAt: "createdAt", expectedDate: "expectedDate", supplier: (d: string) => ({ supplier: { name: d } }) },
      [{ createdAt: "desc" }]
    ) as Prisma.HotelPurchaseOrderOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelPurchaseOrder.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { supplier: { select: { id: true, name: true } }, lines: { select: { quantity: true, receivedQuantity: true, unitCost: true, taxRate: true } } },
      }),
      this.db.hotelPurchaseOrder.count({ where }),
    ]);
    const names = await userNames(this.db, rows.map((r) => r.createdById));
    const warehouses = await this.warehousesById(rows.map((r) => r.warehouseId));
    return {
      data: rows.map((o) => ({
        id: o.id,
        folio: o.folio,
        status: o.status,
        supplier: o.supplier,
        warehouse: warehouses.get(o.warehouseId) ?? null,
        expectedDate: dayOf(o.expectedDate),
        createdBy: userRef(names, o.createdById),
        createdAt: o.createdAt.toISOString(),
        lineCount: o.lines.length,
        pendingQuantity: o.lines.reduce((s, l) => s + pendingOfLine({ quantity: num(l.quantity), receivedQuantity: num(l.receivedQuantity) }), 0),
        ...orderTotals(o.lines.map((l) => ({ quantity: num(l.quantity), unitCost: num(l.unitCost), taxRate: num(l.taxRate) }))),
      })),
      total,
    };
  }

  /** Proveedores activos y tasas de IVA vigentes para capturar la OC (sin depender de permisos de cocina). */
  async lookups() {
    const [suppliers, taxRates] = await Promise.all([
      this.db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.db.taxRate.findMany({ where: { active: true }, select: { id: true, name: true, rate: true }, orderBy: [{ sortOrder: "asc" }, { rate: "asc" }] }),
    ]);
    return { suppliers, taxRates: taxRates.map((r) => ({ id: r.id, name: r.name, rate: num(r.rate) })) };
  }

  async get(id: string) {
    const order = await this.db.hotelPurchaseOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new HttpError(404, "HOTEL_PO_NOT_FOUND");
    return this.serialize(order);
  }

  // ── Escrituras ────────────────────────────────────────────────────────────

  async create(input: HotelPurchaseOrderCreateInput, actorId: string) {
    if (input.supplierId) await this.assertSupplier(input.supplierId);
    const warehouse = await receivingWarehouse(this.db, input.warehouseId);
    const lines = await this.resolveLines(input.lines);
    const created = await runSerializable(async (tx) => {
      return tx.hotelPurchaseOrder.create({
        data: {
          folio: await nextFolio(tx, PURCHASE_ORDER_SEQ, "OC-H"),
          supplierId: input.supplierId ?? null,
          warehouseId: warehouse.id,
          expectedDate: input.expectedDate ? dateOfDay(input.expectedDate) : null,
          notes: input.notes ?? null,
          createdById: actorId,
          lines: { create: lines },
        },
      });
    }, this.db);
    await this.log("HOTEL_LINEN_PO_CREATED", created.id, actorId, {}, { folio: created.folio, lines: lines.length });
    return this.get(created.id);
  }

  /** Solo en borrador. Si vienen renglones, reemplazan a los actuales. */
  async update(id: string, input: HotelPurchaseOrderUpdateInput, actorId: string) {
    const order = await this.require(id);
    if (order.status !== "DRAFT") throw new HttpError(409, "HOTEL_PO_INVALID_STATE", { status: order.status });
    if (input.supplierId) await this.assertSupplier(input.supplierId);
    const warehouse = input.warehouseId ? await receivingWarehouse(this.db, input.warehouseId) : null;
    const lines = input.lines ? await this.resolveLines(input.lines) : null;
    await this.db.$transaction(async (tx) => {
      await tx.hotelPurchaseOrder.update({
        where: { id },
        data: {
          ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
          ...(warehouse ? { warehouseId: warehouse.id } : {}),
          ...(input.expectedDate !== undefined ? { expectedDate: input.expectedDate ? dateOfDay(input.expectedDate) : null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      if (lines) {
        await tx.hotelPurchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.hotelPurchaseOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) });
      }
    });
    await this.log("HOTEL_LINEN_PO_UPDATED", id, actorId, {}, { lines: lines?.length ?? null });
    return this.get(id);
  }

  async approve(id: string, actorId: string) {
    const order = await this.require(id);
    assertCanApprove(order, actorId);
    const moved = await this.db.hotelPurchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() },
    });
    if (moved.count === 0) throw new HttpError(409, "HOTEL_PO_INVALID_STATE");
    await this.log("HOTEL_LINEN_PO_APPROVED", id, actorId, { status: "DRAFT" }, { status: "APPROVED" });
    return this.get(id);
  }

  async cancel(id: string, actorId: string) {
    const order = await this.require(id);
    const receipts = await this.db.hotelPurchaseReceipt.count({ where: { orderId: id } });
    assertCanCancel(order, receipts);
    await this.db.hotelPurchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
    await this.log("HOTEL_LINEN_PO_CANCELLED", id, actorId, { status: order.status }, { status: "CANCELLED" });
    return this.get(id);
  }

  /** Cierra con faltante (motivo obligatorio): libera lo pendiente. */
  async close(id: string, input: HotelPurchaseCloseInput, actorId: string) {
    const order = await this.require(id);
    assertCanClose(order, input.notes);
    await this.db.hotelPurchaseOrder.update({ where: { id }, data: { status: "CLOSED", closedById: actorId, closedAt: new Date(), closeNotes: input.notes } });
    await this.log("HOTEL_LINEN_PO_CLOSED", id, actorId, { status: order.status }, { status: "CLOSED", notes: input.notes });
    return this.get(id);
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async require(id: string) {
    const order = await this.db.hotelPurchaseOrder.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "HOTEL_PO_NOT_FOUND");
    return order;
  }

  private async assertSupplier(id: string) {
    const supplier = await this.db.supplier.findUnique({ where: { id }, select: { active: true } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    if (!supplier.active) throw new HttpError(409, "SUPPLIER_INACTIVE");
  }

  /** Valida productos y cantidades; el costo sin capturar toma el último costo del producto; guarda la tasa de IVA. */
  private async resolveLines(input: HotelPurchaseOrderCreateInput["lines"]) {
    const ids = input.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_PO_LINES_DUPLICATE");
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true, active: true, lastCost: true, unit: { select: { whole: true } } },
    });
    if (products.length !== ids.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    const rateIds = [...new Set(input.map((l) => l.taxRateId).filter((r): r is string => !!r))];
    const rates = await this.db.taxRate.findMany({ where: { id: { in: rateIds } } });
    if (rates.length !== rateIds.length) throw new HttpError(404, "TAX_RATE_NOT_FOUND");
    if (rates.some((r) => !r.active)) throw new HttpError(409, "TAX_RATE_INACTIVE");
    const defaultRate = rateIds.length === input.length ? null : await this.db.taxRate.findFirst({ where: { active: true, rate: new Prisma.Decimal("0.16") } });
    return input.map((line) => {
      const product = products.find((p) => p.id === line.productId)!;
      if (!product.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
      assertWholeQuantity(line.quantity, product.unit.whole);
      const rate = line.taxRateId ? rates.find((r) => r.id === line.taxRateId)! : defaultRate;
      return {
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost ?? num(product.lastCost),
        taxRateId: rate?.id ?? null,
        taxRate: rate?.rate ?? new Prisma.Decimal(0),
      };
    });
  }

  private async warehousesById(ids: string[]) {
    const rows = await this.db.hotelWarehouse.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true, name: true } });
    return new Map(rows.map((w) => [w.id, w]));
  }

  private async serialize(order: OrderRow) {
    const names = await userNames(this.db, [order.createdById, order.approvedById, order.closedById, ...order.receipts.map((r) => r.receivedById)]);
    const warehouse = (await this.warehousesById([order.warehouseId])).get(order.warehouseId) ?? null;
    const lines = order.lines.map((l) => {
      const quantity = num(l.quantity);
      const unitCost = num(l.unitCost);
      const taxRate = num(l.taxRate);
      return {
        id: l.id,
        product: { id: l.product.id, code: l.product.code, name: l.product.name, size: l.product.size, unit: l.product.unit.name },
        quantity,
        receivedQuantity: num(l.receivedQuantity),
        pendingQuantity: pendingOfLine({ quantity, receivedQuantity: num(l.receivedQuantity) }),
        unitCost,
        taxRateId: l.taxRateId,
        taxRate,
        ...lineAmounts({ quantity, unitCost, taxRate }),
      };
    });
    return {
      id: order.id,
      folio: order.folio,
      status: order.status,
      supplier: order.supplier,
      warehouse,
      expectedDate: dayOf(order.expectedDate),
      notes: order.notes,
      closeNotes: order.closeNotes,
      createdBy: userRef(names, order.createdById),
      createdAt: order.createdAt.toISOString(),
      approvedBy: userRef(names, order.approvedById),
      approvedAt: order.approvedAt?.toISOString() ?? null,
      closedBy: userRef(names, order.closedById),
      closedAt: order.closedAt?.toISOString() ?? null,
      lines,
      ...orderTotals(lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate }))),
      receipts: order.receipts.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        date: r.date.toISOString(),
        receivedBy: userRef(names, r.receivedById),
        notes: r.notes,
        lines: r.lines.map((l) => ({
          orderLineId: l.orderLineId,
          receivedQty: num(l.receivedQty),
          acceptedQty: num(l.acceptedQty),
          heldQty: num(l.heldQty),
          lot: l.lot?.code ?? null,
        })),
      })),
    };
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({ action, entityType: "HotelPurchaseOrder", entityId: id, userId: actorId, previousState, newState });
  }
}
