import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { NotificationPort } from "@modules/notifications";
import {
  filterBool,
  filterDateRange,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import { assertWholeQuantity } from "../../services/hotel-catalog-rules";
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelSignatureService } from "./signature.service";
import { SUPPLY_REQUEST_DOC } from "./transfer.service";
import { assertDifferentUsers } from "./transfer-rules";
import type { HotelDirtyReceiptCreateInput } from "../models/dto/laundry.dto";
import {
  DIRTY_ORIGIN_KINDS,
  assertConditionSplit,
  computeShortage,
  planDirtyMoves,
  remainingDelivered,
  shortageRecipients,
} from "./dirty-receipt-rules";
import { dayRange } from "./day-range";
import { roomExtrasDelivered } from "./extra.service";
import { locationIdsOf, runSerializable, warehouseOfKind } from "./linen-locations";

export const DIRTY_RECEIPT_DOC = "HOTEL_DIRTY_RECEIPT";
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;

type Notifier = Pick<NotificationPort, "createManyNotifications">;

/**
 * Recepción de blancos sucios por área y carro (Etapa 3, paso 1) y conciliación diaria.
 * Mueve el sucio del área a lavandería contando, firma quien entrega (cosign) y quien recibe
 * (sesión), y avisa si hay faltante.
 */
export class HotelDirtyReceiptService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /**
   * Entregado a piso por producto (base del día): Σ recibido en el área el día (`from`..`to`) por
   * traspasos cuyo documento de origen es un pedido de área + adicionales a habitación entregados
   * en la zona del área (roomExtrasDelivered).
   */
  async deliveredToFloor(db: PrismaClient | Prisma.TransactionClient, warehouseId: string, from: Date, to: Date) {
    const lines = await db.hotelMovementLine.findMany({
      where: {
        receivedQuantity: { gt: 0 },
        movement: {
          warehouseId,
          sourceDocType: SUPPLY_REQUEST_DOC,
          status: { in: ["ACTIVE", "RECEIVED_WITH_DIFFERENCE"] },
          receivedAt: { gte: from, lt: to },
        },
      },
      select: { productId: true, receivedQuantity: true },
    });
    const out = new Map<string, number>();
    for (const l of lines) out.set(l.productId, (out.get(l.productId) ?? 0) + Number(l.receivedQuantity));
    for (const [productId, qty] of await roomExtrasDelivered(db, warehouseId, from, to)) {
      out.set(productId, (out.get(productId) ?? 0) + qty);
    }
    return out;
  }

  /**
   * Entregado a piso que aún falta justificar (prefill y cada recepción), por producto:
   *   deliveredToFloor = (recibido en el área por pedidos del día + adicionales a habitación)
   *                      − (sucio recibido + sigue en uso) de las recepciones anteriores del mismo día y área.
   * Así varios carros el mismo día no inflan el faltante.
   */
  async openDeliveredToFloor(db: PrismaClient | Prisma.TransactionClient, warehouseId: string, from: Date, to: Date) {
    const base = await this.deliveredToFloor(db, warehouseId, from, to);
    const prior = await db.hotelDirtyReceiptLine.groupBy({
      by: ["productId"],
      where: { receipt: { originWarehouseId: warehouseId, date: { gte: from, lt: to } } },
      _sum: { receivedDirty: true, stillInUse: true },
    });
    const priorBy = new Map(prior.map((p) => [p.productId, p._sum]));
    const out = new Map<string, number>();
    for (const [productId, qty] of base) {
      const p = priorBy.get(productId);
      out.set(productId, remainingDelivered(qty, Number(p?.receivedDirty ?? 0), Number(p?.stillInUse ?? 0)));
    }
    return out;
  }

  /** Precarga del formato: entregado a piso del área ese día, por producto. */
  async prefill(warehouseId: string, date?: string | null) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: WAREHOUSE_SELECT });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    const { from, to } = dayRange(date);
    const delivered = await this.openDeliveredToFloor(this.db, warehouseId, from, to);
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: [...delivered.keys()] } },
      select: { id: true, code: true, name: true, size: true },
      orderBy: { code: "asc" },
    });
    return {
      warehouse,
      date: from,
      lines: products.map((p) => ({ productId: p.id, product: p, deliveredToFloor: delivered.get(p.id) ?? 0 })),
    };
  }

  /**
   * Registra la recepción. Del área sale primero lo que haya en DIRTY; si no alcanza para lo
   * recibido, el resto sale de su GENERAL (el sucio no siempre se registró por carro). Bueno y
   * manchado entran a DIRTY de lavandería; lo roto a QUARANTINE.
   */
  async create(input: HotelDirtyReceiptCreateInput, actorId: string) {
    const origin = await this.db.hotelWarehouse.findUnique({ where: { id: input.originWarehouseId }, select: { ...WAREHOUSE_SELECT, active: true, zoneId: true } });
    if (!origin) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (!origin.active || !DIRTY_ORIGIN_KINDS.includes(origin.kind)) throw new HttpError(422, "HOTEL_DIRTY_ORIGIN_INVALID");
    const laundry = await warehouseOfKind(this.db, "LAUNDRY", null, "HOTEL_LAUNDRY_NOT_CONFIGURED");

    const deliveredById = await this.signatures.resolveCosignUser(input.cosignToken);
    assertDifferentUsers([deliveredById], actorId);

    const ids = input.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_DIRTY_LINES_DUPLICATE");
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: { select: { whole: true } } } });
    if (products.length !== ids.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    for (const line of input.lines) {
      assertConditionSplit(line.receivedDirty, line.good, line.stained, line.damaged);
      const whole = products.find((p) => p.id === line.productId)!.unit.whole;
      for (const n of [line.receivedDirty, line.stillInUse]) assertWholeQuantity(n, whole);
    }

    const date = input.date ? dayRange(input.date).from : new Date();
    const day = dayRange(input.date ?? undefined);
    const originLocations = await locationIdsOf(this.db, origin.id);
    const laundryLocations = await locationIdsOf(this.db, laundry.id);
    const need = (map: Map<string, string>, code: string) => {
      const id = map.get(code);
      if (!id) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code });
      return id;
    };

    const result = await runSerializable(async (tx) => {
      const delivered = await this.openDeliveredToFloor(tx, origin.id, day.from, day.to);
      const lines = input.lines.map((l) => {
        const deliveredToFloor = delivered.get(l.productId) ?? 0;
        return { ...l, deliveredToFloor, shortage: computeShortage(deliveredToFloor, l.receivedDirty, l.stillInUse) };
      });
      const hasShortage = lines.some((l) => l.shortage > 0);

      const count = await tx.hotelDirtyReceipt.count();
      const receipt = await tx.hotelDirtyReceipt.create({
        data: {
          folio: `SU-${String(count + 1).padStart(4, "0")}`,
          originWarehouseId: origin.id,
          cartNumber: input.cartNumber ?? null,
          shift: input.shift ?? null,
          date,
          deliveredById,
          receivedById: actorId,
          notes: input.notes ?? null,
          hasShortage,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              deliveredToFloor: l.deliveredToFloor,
              receivedDirty: l.receivedDirty,
              stillInUse: l.stillInUse,
              shortage: l.shortage,
              good: l.good,
              stained: l.stained,
              damaged: l.damaged,
            })),
          },
        },
      });

      // Movimiento ACTIVE del área a lavandería (una línea por tramo origen/destino).
      const movementLines: Array<{ productId: string; quantity: number; fromLocationId: string; toLocationId: string }> = [];
      for (const l of lines) {
        if (l.receivedDirty <= 0) continue;
        const available = await tx.hotelStock.aggregate({
          where: { productId: l.productId, warehouseId: origin.id, locationId: need(originLocations, "DIRTY") },
          _sum: { quantity: true },
        });
        for (const segment of planDirtyMoves(Number(available._sum.quantity ?? 0), l.good, l.stained, l.damaged)) {
          movementLines.push({
            productId: l.productId,
            quantity: segment.quantity,
            fromLocationId: need(originLocations, segment.from),
            toLocationId: need(laundryLocations, segment.to),
          });
        }
      }
      let movementFolio: string | null = null;
      if (movementLines.length > 0) {
        const movementInput = {
          type: "TRANSFER" as const,
          fromWarehouseId: origin.id,
          warehouseId: laundry.id,
          sourceDocType: DIRTY_RECEIPT_DOC,
          sourceDocId: receipt.id,
          notes: `Recepción de sucios ${receipt.folio}`,
          lines: movementLines,
        };
        assertMovementShape("TRANSFER", movementInput);
        const movement = await this.movements.applyInTransaction(tx, movementInput, actorId, null);
        await tx.hotelDirtyReceipt.update({ where: { id: receipt.id }, data: { movementId: movement.id } });
        movementFolio = movement.folio;
      }
      await this.signatures.sign(DIRTY_RECEIPT_DOC, receipt.id, "DELIVERS", deliveredById, "PASSWORD", tx);
      await this.signatures.sign(DIRTY_RECEIPT_DOC, receipt.id, "RECEIVES", actorId, "SESSION", tx);
      return { receipt, lines, hasShortage, movementFolio };
    }, this.db);

    await this.audit?.({
      action: "HOTEL_LINEN_DIRTY_RECEIVED",
      entityType: "HotelDirtyReceipt",
      entityId: result.receipt.id,
      userId: actorId,
      newState: { folio: result.receipt.folio, origin: origin.id, movement: result.movementFolio, hasShortage: result.hasShortage },
    });
    if (result.hasShortage) {
      const shorts = result.lines.filter((l) => l.shortage > 0);
      const names = new Map(products.map((p) => [p.id, p.code]));
      await this.notifyShortage(origin, result.receipt.folio, shorts.map((l) => `${names.get(l.productId)}: ${l.shortage}`));
    }
    return this.get(result.receipt.id);
  }

  /** Avisa el faltante a supervisores de la zona y Supervisora general (Spa: Gerente de Operaciones). */
  private async notifyShortage(origin: { id: string; name: string; kind: string; zoneId: string | null }, folio: string, detail: string[]) {
    if (!this.notifications) return;
    try {
      const rule = shortageRecipients(origin.kind);
      const userIds = new Set<string>();
      if (rule.zoneSupervisors && origin.zoneId) {
        const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
        const parentOf = new Map(zones.map((z) => [z.id, z.parentId]));
        const chain: string[] = [];
        for (let z: string | null | undefined = origin.zoneId; z && !chain.includes(z); z = parentOf.get(z)) chain.push(z);
        const supervisors = await this.db.hotelZoneSupervisor.findMany({ where: { zoneId: { in: chain } }, select: { userId: true } });
        supervisors.forEach((s) => userIds.add(s.userId));
      }
      const byRole = await this.db.user.findMany({
        where: { active: true, OR: [{ role: { in: rule.roles } }, { extraRoles: { some: { role: { in: rule.roles } } } }] },
        select: { id: true },
      });
      byRole.forEach((u) => userIds.add(u.id));
      await this.notifications.createManyNotifications(
        [...userIds].map((userId) => ({
          userId,
          type: "HOTEL_LINEN_SHORTAGE",
          title: `Faltante de blancos en ${origin.name} (${folio})`,
          detail: detail.join(", "),
        }))
      );
    } catch {
      // El aviso es secundario: un fallo de notificación no revierte la recepción.
    }
  }

  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const origin = filterId(f, "origin");
    const folio = filterText(f, "folio");
    const date = filterDateRange(f, "date");
    const hasShortage = filterBool(f, "hasShortage");
    const where: Prisma.HotelDirtyReceiptWhereInput = {
      ...(origin ? { originWarehouseId: origin } : {}),
      ...(folio ? { folio } : {}),
      ...(date ? { date } : {}),
      ...(hasShortage !== undefined ? { hasShortage } : {}),
      ...(visibleIds ? { AND: [{ originWarehouseId: { in: visibleIds } }] } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", date: "date" }, [{ date: "desc" }]) as Prisma.HotelDirtyReceiptOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelDirtyReceipt.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          originWarehouse: { select: WAREHOUSE_SELECT },
          deliveredBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
          lines: { select: { receivedDirty: true, shortage: true } },
        },
      }),
      this.db.hotelDirtyReceipt.count({ where }),
    ]);
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        folio: r.folio,
        date: r.date,
        cartNumber: r.cartNumber,
        shift: r.shift,
        origin: r.originWarehouse,
        deliveredBy: r.deliveredBy,
        receivedBy: r.receivedBy,
        hasShortage: r.hasShortage,
        receivedDirty: r.lines.reduce((s, l) => s + Number(l.receivedDirty), 0),
        shortage: r.lines.reduce((s, l) => s + Number(l.shortage), 0),
      })),
    };
  }

  async get(id: string) {
    const r = await this.db.hotelDirtyReceipt.findUnique({
      where: { id },
      include: {
        originWarehouse: { select: WAREHOUSE_SELECT },
        deliveredBy: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } }, orderBy: { product: { code: "asc" } } },
      },
    });
    if (!r) throw new HttpError(404, "HOTEL_DIRTY_RECEIPT_NOT_FOUND");
    const signatures = await this.signatures.list(DIRTY_RECEIPT_DOC, id);
    const movement = r.movementId ? await this.db.hotelMovement.findUnique({ where: { id: r.movementId }, select: { id: true, folio: true } }) : null;
    return {
      id: r.id,
      folio: r.folio,
      date: r.date,
      cartNumber: r.cartNumber,
      shift: r.shift,
      notes: r.notes,
      origin: r.originWarehouse,
      originWarehouseId: r.originWarehouseId,
      deliveredBy: r.deliveredBy,
      receivedBy: r.receivedBy,
      hasShortage: r.hasShortage,
      movement,
      lines: r.lines.map((l) => ({
        id: l.id,
        product: l.product,
        deliveredToFloor: Number(l.deliveredToFloor),
        receivedDirty: Number(l.receivedDirty),
        stillInUse: Number(l.stillInUse),
        shortage: Number(l.shortage),
        good: Number(l.good),
        stained: Number(l.stained),
        damaged: Number(l.damaged),
      })),
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Cabecera para decidir el alcance. */
  async header(id: string) {
    const r = await this.db.hotelDirtyReceipt.findUnique({ where: { id }, select: { id: true, originWarehouseId: true } });
    if (!r) throw new HttpError(404, "HOTEL_DIRTY_RECEIPT_NOT_FOUND");
    return r;
  }

  /**
   * Conciliación del día por área y producto, de las áreas con recepción ese día: entregado limpio
   * (recibido en el área por pedidos del día + adicionales a habitación), sucio recibido y sigue en uso (suma de las
   * recepciones del día) y faltante = entregado − recibido − en uso (mínimo 0).
   */
  async dailyReconciliation(date: string | null | undefined, visibleIds: string[] | null) {
    const { from, to } = dayRange(date);
    const receipts = await this.db.hotelDirtyReceipt.findMany({
      where: { date: { gte: from, lt: to }, ...(visibleIds ? { originWarehouseId: { in: visibleIds } } : {}) },
      include: {
        originWarehouse: { select: WAREHOUSE_SELECT },
        lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } } },
      },
    });
    const areas = new Map<string, { warehouse: (typeof receipts)[number]["originWarehouse"]; receipts: number; products: Map<string, { product: (typeof receipts)[number]["lines"][number]["product"]; receivedDirty: number; stillInUse: number }> }>();
    for (const r of receipts) {
      const area = areas.get(r.originWarehouseId) ?? { warehouse: r.originWarehouse, receipts: 0, products: new Map() };
      area.receipts += 1;
      for (const l of r.lines) {
        const p = area.products.get(l.productId) ?? { product: l.product, receivedDirty: 0, stillInUse: 0 };
        p.receivedDirty += Number(l.receivedDirty);
        p.stillInUse += Number(l.stillInUse);
        area.products.set(l.productId, p);
      }
      areas.set(r.originWarehouseId, area);
    }
    const totals = { delivered: 0, receivedDirty: 0, stillInUse: 0, shortage: 0 };
    const out = [];
    for (const [warehouseId, area] of areas) {
      const delivered = await this.deliveredToFloor(this.db, warehouseId, from, to);
      const productIds = new Set([...area.products.keys(), ...delivered.keys()]);
      const missing = [...productIds].filter((id) => !area.products.has(id));
      const extra = missing.length
        ? await this.db.hotelProduct.findMany({ where: { id: { in: missing } }, select: { id: true, code: true, name: true, size: true } })
        : [];
      const lines = [...productIds].map((productId) => {
        const p = area.products.get(productId);
        const product = p?.product ?? extra.find((e) => e.id === productId)!;
        const deliveredQty = delivered.get(productId) ?? 0;
        const receivedDirty = p?.receivedDirty ?? 0;
        const stillInUse = p?.stillInUse ?? 0;
        return { productId, product, delivered: deliveredQty, receivedDirty, stillInUse, shortage: computeShortage(deliveredQty, receivedDirty, stillInUse) };
      }).sort((a, b) => a.product.code.localeCompare(b.product.code));
      const sum = (k: "delivered" | "receivedDirty" | "stillInUse" | "shortage") => lines.reduce((s, l) => s + l[k], 0);
      const areaTotals = { delivered: sum("delivered"), receivedDirty: sum("receivedDirty"), stillInUse: sum("stillInUse"), shortage: sum("shortage") };
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += areaTotals[k];
      out.push({ warehouse: area.warehouse, receipts: area.receipts, lines, totals: areaTotals });
    }
    out.sort((a, b) => a.warehouse.code.localeCompare(b.warehouse.code));
    return { date: from, areas: out, totals };
  }
}
