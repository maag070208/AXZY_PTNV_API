import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { logger } from "@core/utils/logger";
import { broadcastToUser } from "@core/services/ably";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { NotificationPort } from "@modules/notifications";
import { filterEnum, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelPurchaseConvertInput } from "../models/dto/purchase.dto";
import { OPEN_ORDER_STATUSES, aggregateByProduct, lowStockAlertAction, pendingOfLine, suggestRestock, weekRange } from "./purchase-rules";
import { PURCHASE_ORDER_SEQ, PURCHASE_REQUEST_SEQ, nextFolio, num, receivingWarehouse, userNames, userRef } from "./purchase-common";
import { runSerializable } from "./linen-locations";

type Notifier = Pick<NotificationPort, "createManyNotifications">;

const SOURCES = ["WEEKLY_WRITEOFFS", "LOW_STOCK", "MANUAL"] as const;
const STATUSES = ["OPEN", "CONVERTED", "DISMISSED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_TYPE = "HOTEL_LOW_STOCK";
const VIEW_PERMISSION = "hotel_purchase.view";

interface StockEvaluation {
  productId: string;
  code: string;
  name: string;
  available: number;
  min: number;
  target: number;
  pending: number;
  belowMin: boolean;
  suggested: number;
  alertedAt: Date | null;
}

const REQUEST_INCLUDE = {
  lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } }, orderBy: { product: { code: "asc" } } },
  purchaseOrder: { select: { id: true, folio: true, status: true } },
} satisfies Prisma.HotelPurchaseRequestInclude;

/**
 * Solicitudes de reposición (SR-0001): total semanal de bajas autorizadas de blancos, productos bajo
 * mínimo en la bodega de nuevos y el almacén central, o capturadas a mano. Se convierten en una OC en
 * borrador. El job diario genera la de bajo mínimo y avisa una sola vez por cruce.
 */
export class HotelPurchaseRequestService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  // ── Lecturas ──────────────────────────────────────────────────────────────

  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.HotelPurchaseRequestWhereInput = {
      folio: filterText(f, "folio"),
      status: filterEnum(f, "status", STATUSES),
      source: filterEnum(f, "source", SOURCES),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", status: "status", createdAt: "createdAt" }, [{ createdAt: "desc" }]) as Prisma.HotelPurchaseRequestOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelPurchaseRequest.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: REQUEST_INCLUDE }),
      this.db.hotelPurchaseRequest.count({ where }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.serialize(r))), total };
  }

  async get(id: string) {
    const row = await this.db.hotelPurchaseRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!row) throw new HttpError(404, "HOTEL_PURCHASE_REQUEST_NOT_FOUND");
    return this.serialize(row);
  }

  // ── Generación ────────────────────────────────────────────────────────────

  /** Suma las bajas aprobadas (WRITE_OFF ACTIVE) de blancos de la semana por producto. Idempotente por semana. */
  async generateWeekly(weekFrom: string, actorId: string | null) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekFrom);
    if (!match) throw new HttpError(400, "INVALID_FILTER", { field: "weekFrom" });
    const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
    const week = weekRange(new Date(y, m, d));
    if (Number.isNaN(week.from.getTime())) throw new HttpError(400, "INVALID_FILTER", { field: "weekFrom" });
    // Se guarda como día de calendario en UTC (sin corrimiento de zona); la consulta de bajas usa hora local.
    const storedFrom = new Date(Date.UTC(y, m, d));
    const storedTo = new Date(Date.UTC(y, m, d + 6));

    const existing = await this.db.hotelPurchaseRequest.findUnique({ where: { source_weekFrom: { source: "WEEKLY_WRITEOFFS", weekFrom: storedFrom } }, select: { id: true } });
    if (existing) return { created: false, request: await this.get(existing.id) };

    const rows = await this.db.hotelMovementLine.findMany({
      where: { product: { kind: "LINEN" }, movement: { type: "WRITE_OFF", status: "ACTIVE", date: { gte: week.from, lt: week.to } } },
      select: { productId: true, quantity: true },
    });
    const totals = aggregateByProduct(rows.map((r) => ({ productId: r.productId, quantity: num(r.quantity) })));
    if (totals.length === 0) return { created: false, request: null };

    try {
      const created = await runSerializable(async (tx) =>
        tx.hotelPurchaseRequest.create({
          data: {
            folio: await nextFolio(tx, PURCHASE_REQUEST_SEQ, "SR"),
            source: "WEEKLY_WRITEOFFS",
            weekFrom: storedFrom,
            weekTo: storedTo,
            createdById: actorId,
            lines: { create: totals.map((t) => ({ productId: t.productId, quantity: t.quantity, reason: "Bajas autorizadas de la semana" })) },
          },
        }), this.db);
      await this.log("HOTEL_LINEN_REQUEST_REPLENISH_CREATED", created.id, actorId, { source: "WEEKLY_WRITEOFFS", folio: created.folio, lines: totals.length });
      return { created: true, request: await this.get(created.id) };
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        const again = await this.db.hotelPurchaseRequest.findUnique({ where: { source_weekFrom: { source: "WEEKLY_WRITEOFFS", weekFrom: storedFrom } }, select: { id: true } });
        if (again) return { created: false, request: await this.get(again.id) };
      }
      throw err;
    }
  }

  /**
   * Productos bajo su mínimo en la bodega de nuevos y el central (límite del almacén o mínimo del producto),
   * restando lo pendiente en OC abiertas. No duplica productos que ya están en una solicitud OPEN.
   */
  async generateLowStock(actorId: string | null) {
    const evaluation = await this.evaluateLowStock();
    const openLines = await this.db.hotelPurchaseRequestLine.findMany({ where: { request: { status: "OPEN" } }, select: { productId: true } });
    const covered = new Set(openLines.map((l) => l.productId));
    const fresh = evaluation.filter((e) => e.suggested > 0 && !covered.has(e.productId));
    if (fresh.length === 0) return { created: false, request: null, evaluation };
    const created = await runSerializable(async (tx) =>
      tx.hotelPurchaseRequest.create({
        data: {
          folio: await nextFolio(tx, PURCHASE_REQUEST_SEQ, "SR"),
          source: "LOW_STOCK",
          createdById: actorId,
          lines: {
            create: fresh.map((e) => ({
              productId: e.productId,
              quantity: e.suggested,
              reason: `Bajo mínimo: disponible ${e.available}, mínimo ${e.min}, pendiente en OC ${e.pending}`,
            })),
          },
        },
      }), this.db);
    await this.log("HOTEL_LINEN_REQUEST_REPLENISH_CREATED", created.id, actorId, { source: "LOW_STOCK", folio: created.folio, lines: fresh.length });
    return { created: true, request: await this.get(created.id), evaluation };
  }

  /** Convierte la solicitud en una OC en borrador agrupada en el proveedor indicado. */
  async convert(id: string, input: HotelPurchaseConvertInput, actorId: string) {
    const request = await this.db.hotelPurchaseRequest.findUnique({ where: { id }, include: { lines: true } });
    if (!request) throw new HttpError(404, "HOTEL_PURCHASE_REQUEST_NOT_FOUND");
    if (request.status !== "OPEN") throw new HttpError(409, "HOTEL_PURCHASE_REQUEST_INVALID_STATE");
    const supplier = await this.db.supplier.findUnique({ where: { id: input.supplierId }, select: { active: true } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    if (!supplier.active) throw new HttpError(409, "SUPPLIER_INACTIVE");
    const warehouse = await receivingWarehouse(this.db, input.warehouseId);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: request.lines.map((l) => l.productId) } }, select: { id: true, lastCost: true } });
    const vat = await this.db.taxRate.findFirst({ where: { active: true, rate: new Prisma.Decimal("0.16") } });

    const orderId = await runSerializable(async (tx) => {
      const claimed = await tx.hotelPurchaseRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "CONVERTED" } });
      if (claimed.count === 0) throw new HttpError(409, "HOTEL_PURCHASE_REQUEST_INVALID_STATE");
      const order = await tx.hotelPurchaseOrder.create({
        data: {
          folio: await nextFolio(tx, PURCHASE_ORDER_SEQ, "OC-H"),
          supplierId: input.supplierId,
          warehouseId: warehouse.id,
          createdById: actorId,
          notes: `Solicitud ${request.folio}`,
          lines: {
            create: request.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCost: products.find((p) => p.id === l.productId)?.lastCost ?? 0,
              taxRateId: vat?.id ?? null,
              taxRate: vat?.rate ?? new Prisma.Decimal(0),
            })),
          },
        },
      });
      await tx.hotelPurchaseRequest.update({ where: { id }, data: { purchaseOrderId: order.id } });
      return order.id;
    }, this.db);
    await this.log("HOTEL_LINEN_REQUEST_REPLENISH_CONVERTED", id, actorId, { orderId });
    return { orderId, request: await this.get(id) };
  }

  async dismiss(id: string, actorId: string) {
    const moved = await this.db.hotelPurchaseRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "DISMISSED" } });
    if (moved.count === 0) {
      const exists = await this.db.hotelPurchaseRequest.findUnique({ where: { id }, select: { id: true } });
      throw new HttpError(exists ? 409 : 404, exists ? "HOTEL_PURCHASE_REQUEST_INVALID_STATE" : "HOTEL_PURCHASE_REQUEST_NOT_FOUND");
    }
    await this.log("HOTEL_LINEN_REQUEST_REPLENISH_DISMISSED", id, actorId, {});
    return this.get(id);
  }

  // ── Job diario ────────────────────────────────────────────────────────────

  /** Revisa al arrancar (con un minuto de margen) y luego cada 24 h. */
  startDailyCheck(): void {
    if (this.timer) return;
    const tick = () => void this.runDaily().catch((err) => logger.error(`[hotel-purchase] ${String(err)}`));
    setTimeout(tick, 90_000).unref();
    this.timer = setInterval(tick, DAY_MS);
    this.timer.unref();
  }

  /**
   * Genera la solicitud de bajo mínimo y avisa una sola vez por cruce a quien tenga `hotel_purchase.view`:
   * `lowStockAlertedAt` se marca al cruzar y se limpia al subir sobre el mínimo.
   */
  async runDaily() {
    const evaluation = await this.evaluateLowStock();
    const crossed: StockEvaluation[] = [];
    for (const e of evaluation) {
      const action = lowStockAlertAction(e.belowMin, e.alertedAt !== null);
      if (action === "CLEAR") await this.db.hotelProduct.updateMany({ where: { id: e.productId, lowStockAlertedAt: { not: null } }, data: { lowStockAlertedAt: null } });
      if (action === "ALERT") {
        // El updateMany con la marca nula evita que dos corridas avisen el mismo cruce.
        const marked = await this.db.hotelProduct.updateMany({ where: { id: e.productId, lowStockAlertedAt: null }, data: { lowStockAlertedAt: new Date() } });
        if (marked.count > 0) crossed.push(e);
      }
    }
    const generated = await this.generateLowStock(null);
    if (crossed.length > 0) await this.notifyCrossings(crossed, generated.request?.folio ?? null);
    return { crossed: crossed.length, requestCreated: generated.created };
  }

  /** Evaluación por producto: disponible en nuevos + central (sin HOLD), mínimo, objetivo y pendiente en OC. */
  async evaluateLowStock(): Promise<StockEvaluation[]> {
    const warehouses = await this.db.hotelWarehouse.findMany({ where: { active: true, kind: { in: ["NEW_LINEN", "CENTRAL"] } }, select: { id: true } });
    const warehouseIds = warehouses.map((w) => w.id);
    if (warehouseIds.length === 0) return [];
    const [products, stock, openOrderLines] = await Promise.all([
      this.db.hotelProduct.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true, minStock: true, idealStock: true, lowStockAlertedAt: true, warehouseLimits: { where: { warehouseId: { in: warehouseIds } }, select: { warehouseId: true, minStock: true, maxStock: true } } },
      }),
      this.db.hotelStock.findMany({ where: { warehouseId: { in: warehouseIds }, quantity: { gt: 0 }, location: { code: { not: "HOLD" } } }, select: { productId: true, warehouseId: true, quantity: true } }),
      this.db.hotelPurchaseOrderLine.findMany({ where: { order: { status: { in: OPEN_ORDER_STATUSES } } }, select: { productId: true, quantity: true, receivedQuantity: true } }),
    ]);
    const pendingBy = new Map<string, number>();
    for (const l of openOrderLines) pendingBy.set(l.productId, (pendingBy.get(l.productId) ?? 0) + pendingOfLine({ quantity: num(l.quantity), receivedQuantity: num(l.receivedQuantity) }));
    const result: StockEvaluation[] = [];
    for (const p of products) {
      const limits = p.warehouseLimits.filter((l) => num(l.minStock) > 0);
      const scope = limits.length > 0 ? new Set(limits.map((l) => l.warehouseId)) : null;
      const min = limits.length > 0 ? limits.reduce((s, l) => s + num(l.minStock), 0) : num(p.minStock);
      const max = limits.length > 0 ? limits.reduce((s, l) => s + num(l.maxStock), 0) : 0;
      if (min <= 0) {
        result.push({ productId: p.id, code: p.code, name: p.name, available: 0, min: 0, target: 0, pending: 0, belowMin: false, suggested: 0, alertedAt: p.lowStockAlertedAt });
        continue;
      }
      const available = stock.filter((s) => s.productId === p.id && (!scope || scope.has(s.warehouseId))).reduce((sum, s) => sum + num(s.quantity), 0);
      const target = max > 0 ? max : num(p.idealStock);
      const pending = pendingBy.get(p.id) ?? 0;
      result.push({
        productId: p.id,
        code: p.code,
        name: p.name,
        available,
        min,
        target,
        pending,
        belowMin: available <= min,
        suggested: suggestRestock({ available, min, target, pending }),
        alertedAt: p.lowStockAlertedAt,
      });
    }
    return result;
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async notifyCrossings(crossed: StockEvaluation[], folio: string | null) {
    if (!this.notifications) return;
    try {
      const roles = await this.db.rolePermission.findMany({
        where: { permission: VIEW_PERMISSION, scope: { not: "NONE" }, roleRef: { active: true } },
        select: { role: true },
      });
      const keys = roles.map((r) => r.role);
      if (keys.length === 0) return;
      const users = await this.db.user.findMany({
        where: { active: true, OR: [{ role: { in: keys } }, { extraRoles: { some: { role: { in: keys } } } }] },
        select: { id: true },
      });
      const title = `Blancos: ${crossed.length} producto(s) bajo mínimo`;
      const detail = `${crossed.slice(0, 8).map((c) => `${c.code} (${c.available}/${c.min})`).join(", ")}${crossed.length > 8 ? "…" : ""}${folio ? ` · ${folio}` : ""}`;
      await this.notifications.createManyNotifications(users.map((u) => ({ userId: u.id, type: NOTIFICATION_TYPE, title, detail })));
      for (const u of users) broadcastToUser(u.id, { type: NOTIFICATION_TYPE, title, detail, createdAt: new Date().toISOString() }).catch(() => {});
    } catch (err) {
      // El aviso es secundario: un fallo de notificación no revierte la marca ni la solicitud.
      logger.warn(`[hotel-purchase] aviso de bajo mínimo: ${String(err)}`);
    }
  }

  private async serialize(row: Prisma.HotelPurchaseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>) {
    const names = await userNames(this.db, [row.createdById]);
    return {
      id: row.id,
      folio: row.folio,
      source: row.source,
      status: row.status,
      weekFrom: row.weekFrom ? row.weekFrom.toISOString().slice(0, 10) : null,
      weekTo: row.weekTo ? row.weekTo.toISOString().slice(0, 10) : null,
      notes: row.notes,
      createdBy: userRef(names, row.createdById),
      createdAt: row.createdAt.toISOString(),
      purchaseOrder: row.purchaseOrder,
      lines: row.lines.map((l) => ({ id: l.id, product: l.product, quantity: num(l.quantity), reason: l.reason })),
    };
  }

  private async log(action: string, id: string, actorId: string | null, newState: object) {
    if (!actorId) return;
    await this.audit?.({ action, entityType: "HotelPurchaseRequest", entityId: id, userId: actorId, newState });
  }
}
