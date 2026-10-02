import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { type ErrorCode } from "@core/i18n";
import { evaluateActionPolicies } from "@core/policies";
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
  INVOICE_STATUSES,
  type SupplierInvoiceCreateInput,
} from "../models/dto/kitchen.dto";

const num = (d: Prisma.Decimal) => d.toNumber();
const numOrNull = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const dec3 = (n: number) => new Prisma.Decimal(n.toFixed(3));
const dec4 = (n: number) => new Prisma.Decimal(n.toFixed(4));
const dec2 = (n: number) => new Prisma.Decimal(n.toFixed(2));
const decTax = (n: number) => new Prisma.Decimal(n.toFixed(4));
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Importes de un renglón: subtotal (antes de IVA), IVA y total. */
const lineAmounts = (quantity: number, unitCost: number, taxRate: number) => {
  const subtotal = round2(quantity * unitCost);
  const tax = round2(subtotal * taxRate);
  return { subtotal, tax, total: round2(subtotal + tax) };
};

interface RateBucket {
  base: number;
  tax: number;
}
const bucketTaxes = (buckets: Map<number, RateBucket>) =>
  [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({ rate, base: round2(v.base), tax: round2(v.tax) }));

const addToBucket = (buckets: Map<number, RateBucket>, rate: number, amounts: { subtotal: number; tax: number }) => {
  const bucket = buckets.get(rate) ?? { base: 0, tax: 0 };
  bucket.base += amounts.subtotal;
  bucket.tax += amounts.tax;
  buckets.set(rate, bucket);
};

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Facturas de proveedor (F4). Se registran (con o sin orden de compra), su costo
 * actualiza el `unitCost` de los lotes recibidos por esa OC y el detalle muestra
 * el cotejo de tres vías (pedido / recibido / facturado).
 */
export class SupplierInvoiceService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Contexto del usuario para las políticas ABAC (rol principal + adicionales). */
  private async policyUser(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        departmentId: true,
        extraRoles: { select: { role: true } },
      },
    });
    return {
      id: userId,
      role: user?.role ?? "",
      roles: [user?.role ?? "", ...(user?.extraRoles ?? []).map((r) => r.role)],
      departmentId: user?.departmentId ?? null,
    };
  }

  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.SupplierInvoiceWhereInput = {
      number: filterText(f, "number"),
      uuid: filterText(f, "uuid"),
      supplierId: filterId(f, "supplierId"),
      purchaseOrderId: filterId(f, "purchaseOrderId"),
      status: filterEnum(f, "status", INVOICE_STATUSES),
      date: filterDayRange(f, "date"),
    };
    const orderBy = orderByOf(
      params.sort,
      {
        number: "number",
        date: "date",
        total: "total",
        status: "status",
        supplier: (d: string) => ({ supplier: { name: d } }),
      },
      [{ date: "desc" }, { createdAt: "desc" }]
    ) as Prisma.SupplierInvoiceOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.supplierInvoice.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.db.supplierInvoice.count({ where }),
    ]);
    return {
      data: rows.map((i) => ({
        id: i.id,
        number: i.number,
        uuid: i.uuid,
        supplier: i.supplier,
        purchaseOrder: i.purchaseOrder,
        date: dayOf(i.date),
        total: num(i.total),
        status: i.status,
        createdBy: i.createdBy,
      })),
      total,
    };
  }

  async detail(id: string) {
    const invoice = await this.db.supplierInvoice.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, number: true } },
        createdBy: { select: { id: true, name: true } },
        lines: {
          include: {
            item: { select: { id: true, code: true, name: true, unit: { select: { id: true, code: true, name: true, whole: true } } } },
            purchaseOrderLine: { select: { id: true, quantity: true, unitCost: true, receivedQuantity: true, taxRateId: true, taxRate: true } },
          },
          orderBy: { item: { name: "asc" } },
        },
      },
    });
    if (!invoice) throw new HttpError(404, "SUPPLIER_INVOICE_NOT_FOUND");

    // Facturado por renglón de OC (todas las facturas activas del proveedor).
    const poLineIds = invoice.lines.map((l) => l.purchaseOrderLineId).filter((v): v is string => v !== null);
    const invoiced = poLineIds.length
      ? await this.db.supplierInvoiceLine.groupBy({
          by: ["purchaseOrderLineId"],
          where: { purchaseOrderLineId: { in: poLineIds }, invoice: { status: "ACTIVE" } },
          _sum: { quantity: true },
        })
      : [];
    const invoicedByLine = new Map(invoiced.map((r) => [r.purchaseOrderLineId as string, num(r._sum.quantity ?? new Prisma.Decimal(0))]));

    // IVA de la factura (calculado de sus renglones) contra el de la OC. La tasa
    // de la OC se aplica al mismo precio/la misma cantidad para aislar la
    // diferencia de IVA; no bloquea, solo se reporta.
    const invoiceBuckets = new Map<number, RateBucket>();
    const orderBuckets = new Map<number, RateBucket>();
    let invoiceSubtotal = 0;
    let invoiceTax = 0;
    let orderSubtotal = 0;
    let orderTax = 0;
    for (const l of invoice.lines) {
      const quantity = num(l.quantity);
      const unitCost = num(l.unitCost);
      const rate = num(l.taxRate);
      const a = lineAmounts(quantity, unitCost, rate);
      invoiceSubtotal += a.subtotal;
      invoiceTax += a.tax;
      addToBucket(invoiceBuckets, rate, a);
      const poRate = l.purchaseOrderLine ? num(l.purchaseOrderLine.taxRate) : rate;
      const o = lineAmounts(quantity, unitCost, poRate);
      orderSubtotal += o.subtotal;
      orderTax += o.tax;
      addToBucket(orderBuckets, poRate, o);
    }
    const hasOrder = invoice.purchaseOrderId != null;
    const taxDiff = hasOrder ? round2(invoiceTax - orderTax) : null;

    return {
      id: invoice.id,
      number: invoice.number,
      uuid: invoice.uuid,
      date: dayOf(invoice.date),
      supplier: invoice.supplier,
      purchaseOrder: invoice.purchaseOrder,
      subtotal: numOrNull(invoice.subtotal),
      tax: numOrNull(invoice.tax),
      total: num(invoice.total),
      status: invoice.status,
      notes: invoice.notes,
      createdBy: invoice.createdBy,
      createdAt: invoice.createdAt.toISOString(),
      taxTotals: {
        subtotal: round2(invoiceSubtotal),
        tax: round2(invoiceTax),
        total: round2(invoiceSubtotal + invoiceTax),
        byRate: bucketTaxes(invoiceBuckets),
        order: hasOrder
          ? {
              subtotal: round2(orderSubtotal),
              tax: round2(orderTax),
              total: round2(orderSubtotal + orderTax),
              byRate: bucketTaxes(orderBuckets),
            }
          : null,
        taxDiff,
      },
      lines: invoice.lines.map((l) => {
        const ordered = l.purchaseOrderLine ? num(l.purchaseOrderLine.quantity) : null;
        const received = l.purchaseOrderLine ? num(l.purchaseOrderLine.receivedQuantity) : null;
        const poUnitCost = l.purchaseOrderLine?.unitCost == null ? null : num(l.purchaseOrderLine.unitCost);
        const invoicedQuantity = l.purchaseOrderLineId ? invoicedByLine.get(l.purchaseOrderLineId) ?? 0 : null;
        const taxRate = num(l.taxRate);
        const tax = round2(num(l.quantity) * num(l.unitCost) * taxRate);
        const poTaxRate = l.purchaseOrderLine ? num(l.purchaseOrderLine.taxRate) : null;
        const poTax = poTaxRate == null ? null : round2(num(l.quantity) * num(l.unitCost) * poTaxRate);
        return {
          id: l.id,
          item: l.item,
          purchaseOrderLineId: l.purchaseOrderLineId,
          quantity: num(l.quantity),
          unitCost: num(l.unitCost),
          ordered,
          received,
          invoicedQuantity,
          priceDiff: poUnitCost == null ? null : round1(num(l.unitCost) - poUnitCost),
          taxRateId: l.taxRateId,
          taxRate,
          tax,
          poTaxRate,
          taxRateDiff: poTaxRate == null ? null : round4(taxRate - poTaxRate),
          taxDiff: poTax == null ? null : round2(tax - poTax),
        };
      }),
    };
  }

  async register(input: SupplierInvoiceCreateInput, actorId: string) {
    const supplier = await this.db.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    if (!supplier.active) throw new HttpError(409, "SUPPLIER_INACTIVE");

    let purchaseOrderId: string | null = null;
    if (input.purchaseOrderId) {
      const po = await this.db.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        select: { id: true, supplierId: true, status: true, createdById: true, approvedById: true },
      });
      if (!po) throw new HttpError(404, "PURCHASE_ORDER_NOT_FOUND");
      if (po.supplierId !== input.supplierId) throw new HttpError(400, "INVOICE_SUPPLIER_MISMATCH");

      // Política ABAC dinámica: estado de la OC + segregación de funciones.
      const actor = await this.policyUser(actorId);
      const decision = evaluateActionPolicies("invoices.register", actor, {
        status: po.status,
        createdById: po.createdById,
        approvedById: po.approvedById,
      });
      if (!decision.allowed) {
        throw new HttpError(
          403,
          (decision.code ?? "FORBIDDEN") as ErrorCode,
          {},
          decision.reason ? { reason: decision.reason } : undefined
        );
      }
      purchaseOrderId = po.id;
    }

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await this.db.kitchenItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, active: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of itemIds) {
      const item = byId.get(id);
      if (!item) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
      if (!item.active) throw new HttpError(409, "KITCHEN_ITEM_INACTIVE", { item: item.name });
    }

    const taxOf = await this.resolveLineTax(input.lines);

    const invoice = await this.db
      .$transaction(async (tx) => {
        const created = await tx.supplierInvoice.create({
          data: {
            supplierId: input.supplierId,
            purchaseOrderId,
            number: input.number,
            uuid: input.uuid ?? null,
            date: dateOfDay(input.date),
            subtotal: input.subtotal == null ? null : dec2(input.subtotal),
            tax: input.tax == null ? null : dec2(input.tax),
            total: dec2(input.total),
            notes: input.notes ?? null,
            createdById: actorId,
            lines: {
              create: input.lines.map((l) => ({
                itemId: l.itemId,
                purchaseOrderLineId: l.purchaseOrderLineId ?? null,
                quantity: dec3(l.quantity),
                unitCost: dec4(l.unitCost),
                ...taxOf(l),
              })),
            },
          },
          select: { id: true },
        });

        // El costo facturado actualiza los lotes recibidos por esa OC.
        if (purchaseOrderId) {
          for (const line of input.lines) {
            const movementLines = await tx.kitchenMovementLine.findMany({
              where: {
                itemId: line.itemId,
                movement: { purchaseOrderId, type: "STOCK_IN", status: "ACTIVE" },
              },
              select: { lotId: true },
            });
            const lotIds = [...new Set(movementLines.map((m) => m.lotId))];
            if (lotIds.length > 0) {
              await tx.kitchenLot.updateMany({ where: { id: { in: lotIds } }, data: { unitCost: dec4(line.unitCost) } });
            }
          }
        }
        // Último precio de lo que surte el proveedor, por su unidad de compra
        // (la factura trae costo por unidad base: × factor).
        const presentations = await tx.supplierItem.findMany({
          where: { supplierId: input.supplierId, itemId: { in: itemIds } },
          select: { id: true, itemId: true, factor: true },
        });
        const invoicedAt = dateOfDay(input.date);
        for (const p of presentations) {
          const line = [...input.lines].reverse().find((l) => l.itemId === p.itemId)!;
          await tx.supplierItem.update({
            where: { id: p.id },
            data: { lastUnitCost: dec4(line.unitCost * p.factor.toNumber()), lastPurchasedAt: invoicedAt },
          });
        }
        return created;
      })
      .catch((err) => {
        if (isUniqueViolation(err)) throw new HttpError(409, "SUPPLIER_INVOICE_NUMBER_TAKEN");
        throw err;
      });

    await this.audit?.({
      action: "SUPPLIER_INVOICE_REGISTERED",
      entityType: "SupplierInvoice",
      entityId: invoice.id,
      userId: actorId,
      metadata: { number: input.number, total: input.total, purchaseOrderId },
    });
    return this.detail(invoice.id);
  }

  /**
   * Resuelve la tasa de IVA de cada renglón: la explícita del renglón, la de la
   * línea de la OC referida o, en su defecto, sin IVA. Devuelve el id del
   * catálogo y la fracción como fotografía.
   */
  private async resolveLineTax(lines: SupplierInvoiceCreateInput["lines"]) {
    const explicit = [...new Set(lines.map((l) => l.taxRateId).filter((id): id is string => Boolean(id)))];
    const poLineIds = [...new Set(lines.map((l) => l.purchaseOrderLineId).filter((id): id is string => Boolean(id)))];
    const [rates, poLines] = await Promise.all([
      explicit.length ? this.db.taxRate.findMany({ where: { id: { in: explicit } } }) : Promise.resolve([]),
      poLineIds.length
        ? this.db.purchaseOrderLine.findMany({ where: { id: { in: poLineIds } }, select: { id: true, taxRateId: true, taxRate: true } })
        : Promise.resolve([]),
    ]);
    const rateById = new Map(rates.map((r) => [r.id, r]));
    for (const id of explicit) {
      const rate = rateById.get(id);
      if (!rate) throw new HttpError(404, "TAX_RATE_NOT_FOUND");
      if (!rate.active) throw new HttpError(409, "TAX_RATE_INACTIVE");
    }
    const poById = new Map(poLines.map((l) => [l.id, l]));
    return (line: SupplierInvoiceCreateInput["lines"][number]) => {
      if (line.taxRateId === null) return { taxRateId: null, taxRate: new Prisma.Decimal(0) };
      if (line.taxRateId) {
        const rate = rateById.get(line.taxRateId)!;
        return { taxRateId: rate.id, taxRate: decTax(num(rate.rate)) };
      }
      const poLine = line.purchaseOrderLineId ? poById.get(line.purchaseOrderLineId) : undefined;
      if (poLine) return { taxRateId: poLine.taxRateId, taxRate: poLine.taxRate };
      return { taxRateId: null, taxRate: new Prisma.Decimal(0) };
    };
  }

  async cancel(id: string, notes: string | null | undefined, actorId: string) {
    const invoice = await this.db.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) throw new HttpError(404, "SUPPLIER_INVOICE_NOT_FOUND");
    if (invoice.status === "CANCELLED") return this.detail(id);
    await this.db.supplierInvoice.update({
      where: { id },
      data: { status: "CANCELLED", ...(notes ? { notes } : {}) },
    });
    await this.audit?.({ action: "SUPPLIER_INVOICE_CANCELLED", entityType: "SupplierInvoice", entityId: id, userId: actorId });
    return this.detail(id);
  }
}

/** Redondeo a 1 decimal (para mostrar diferencias de precio). */
const round1 = (n: number) => Math.round(n * 10) / 10;
