import { Prisma, type HotelAmenityControlStatus, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  endOfLocalDay,
  resolveTimezoneWithConfig,
  resolveWeekStartWithConfig,
  startOfLocalDay,
} from "@core/utils/timezone";
import { filterDateRange, filterEnum, filterId, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { NotificationPort } from "@modules/notifications";
import type { HotelSignatureService } from "./signature.service";
import type { HotelAmenityControlSaveInput } from "../models/dto/amenity.dto";
import { zoneSubtree } from "./supply-request-rules";
import { dayRange } from "./day-range";
import { runSerializable } from "./linen-locations";
import { occupiedRoomNights } from "./amenity-occupancy";
import {
  ACKNOWLEDGE_ROLES,
  REVIEW_ROLES,
  addDaysKey,
  atOrBelowMin,
  balanceAt,
  computeAmenityLine,
  exceedsThreshold,
  hasAnyRole,
  netInWindow,
  warehouseEvents,
  weekStartKey,
  weightedStandard,
  type LedgerMovement,
} from "./amenity-rules";

export const AMENITY_CONTROL_DOC = "HOTEL_AMENITY_CONTROL";
const STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "ACKNOWLEDGED"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const PRODUCT_SELECT = { id: true, code: true, name: true, unit: { select: { name: true } } } as const;
const AMENITY_WAREHOUSE_CODE = "AME";

type Notifier = Pick<NotificationPort, "createManyNotifications">;
type Caller = { id: string; roles?: string[] };

export interface AmenityLine {
  product: { id: string; code: string; name: string; unit: string };
  standardPerRoom: number;
  initialStock: number;
  supplied: number;
  extras: number;
  finalStock: number;
  systemFinalStock: number;
  realConsumption: number;
  expectedConsumption: number;
  diffPct: number | null;
  flagged: boolean;
}

const num = (v: Prisma.Decimal | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Control semanal de amenidades (Etapa 4, pasos 5-8). El cálculo se rehace contra el libro mayor al
 * guardar y al enviar; al enviar queda como fotografía. Elabora (CONFIRMS) -> revisa (REVIEWS, Supervisora
 * general) -> enterado (AUTHORIZES, Gerente de Operaciones).
 */
export class HotelAmenityService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  private async sysConfig(key: string): Promise<string | null> {
    return (await this.db.sysConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
  }

  /** Semana (jueves→miércoles por defecto, `WEEK_START_DAY`) que contiene `anyDayKey`. */
  async weekOf(anyDayKey: string) {
    const [tz, weekStart] = await Promise.all([
      resolveTimezoneWithConfig(undefined, (k) => this.sysConfig(k)),
      resolveWeekStartWithConfig((k) => this.sysConfig(k)),
    ]);
    const weekFrom = weekStartKey(anyDayKey, weekStart);
    return { tz, weekFrom, weekTo: addDaysKey(weekFrom, 6) };
  }

  /** Cálculo de la semana de un área. `finals` = existencia final capturada por producto. */
  async compute(warehouseId: string, anyDayKey: string, finals: Map<string, number> = new Map(), override: number | null = null) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { ...WAREHOUSE_SELECT, zoneId: true, active: true } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    if (warehouse.kind !== "ZONE" || !warehouse.zoneId) throw new HttpError(422, "HOTEL_AMENITY_AREA_INVALID");
    const { tz, weekFrom, weekTo } = await this.weekOf(anyDayKey);
    const start = startOfLocalDay(weekFrom, tz);
    const end = endOfLocalDay(weekTo, tz);

    const zones = await this.db.hotelZone.findMany({ select: { id: true, parentId: true } });
    const zoneIds = [...zoneSubtree(zones, warehouse.zoneId)];
    const rooms = await this.db.hotelRoom.findMany({
      where: { active: true, zoneId: { in: zoneIds }, type: { kit: { is: { active: true } } } },
      select: { type: { select: { kit: { select: { lines: { where: { product: { kind: "CONSUMABLE" } }, select: { productId: true, quantity: true } } } } } } },
    });
    const standard = weightedStandard(
      rooms.map((r) => ({ lines: (r.type.kit?.lines ?? []).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })) }))
    );

    const [stockRows, movements, extraMovements, occupiedNights] = await Promise.all([
      this.db.hotelStock.findMany({ where: { warehouseId, product: { kind: "CONSUMABLE" } }, select: { productId: true, quantity: true } }),
      this.db.hotelMovement.findMany({
        where: {
          status: { in: ["ACTIVE", "IN_TRANSIT", "RECEIVED_WITH_DIFFERENCE"] },
          OR: [{ fromWarehouseId: warehouseId }, { warehouseId }],
          AND: [{ OR: [{ date: { gte: start } }, { receivedAt: { gte: start } }] }],
        },
        select: {
          type: true, status: true, date: true, receivedAt: true, fromWarehouseId: true, warehouseId: true,
          lines: { select: { productId: true, quantity: true, receivedQuantity: true, product: { select: { kind: true } } } },
        },
      }),
      // Extras a habitación (hotel_room_extras de F4 registra ROOM_EXTRA): consumibles de habitaciones de la zona.
      this.db.hotelMovement.findMany({
        where: {
          type: "ROOM_EXTRA",
          status: "ACTIVE",
          date: { gte: start, lt: end },
          room: { is: { zoneId: { in: zoneIds } } },
        },
        select: { lines: { where: { product: { kind: "CONSUMABLE" } }, select: { productId: true, quantity: true } } },
      }),
      occupiedRoomNights(zoneIds, weekFrom, weekTo, tz, this.db),
    ]);

    const ledger: LedgerMovement[] = movements.map((m) => ({
      type: m.type,
      status: m.status,
      date: m.date,
      receivedAt: m.receivedAt,
      fromWarehouseId: m.fromWarehouseId,
      warehouseId: m.warehouseId,
      lines: m.lines
        .filter((l) => l.product.kind === "CONSUMABLE")
        .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), receivedQuantity: l.receivedQuantity === null ? null : Number(l.receivedQuantity) })),
    }));
    const events = warehouseEvents(ledger, warehouseId);
    const current = new Map<string, number>();
    for (const row of stockRows) current.set(row.productId, (current.get(row.productId) ?? 0) + Number(row.quantity));
    const initial = balanceAt(current, events, start);
    const systemFinal = balanceAt(current, events, end);
    const supplied = netInWindow(events, start, end, "IN");
    const extras = new Map<string, number>();
    for (const m of extraMovements) for (const l of m.lines) extras.set(l.productId, (extras.get(l.productId) ?? 0) + Number(l.quantity));

    const productIds = new Set<string>([...standard.keys(), ...current.keys(), ...initial.keys(), ...supplied.keys(), ...extras.keys(), ...finals.keys()]);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: [...productIds] }, kind: "CONSUMABLE" }, select: PRODUCT_SELECT, orderBy: { code: "asc" } });
    const effectiveNights = override ?? occupiedNights;
    const lines: AmenityLine[] = products.map((p) => {
      const input = {
        standardPerRoom: standard.get(p.id) ?? 0,
        initialStock: initial.get(p.id) ?? 0,
        supplied: supplied.get(p.id) ?? 0,
        extras: extras.get(p.id) ?? 0,
        finalStock: finals.get(p.id) ?? Math.max(systemFinal.get(p.id) ?? 0, 0),
      };
      const result = computeAmenityLine(effectiveNights, input);
      return {
        product: { id: p.id, code: p.code, name: p.name, unit: p.unit.name },
        ...input,
        systemFinalStock: Math.max(systemFinal.get(p.id) ?? 0, 0),
        ...result,
        flagged: exceedsThreshold(result),
      };
    }).filter((l) => l.standardPerRoom || l.initialStock || l.supplied || l.extras || l.finalStock || l.systemFinalStock);

    return {
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, kind: warehouse.kind },
      weekFrom,
      weekTo,
      rooms: rooms.length,
      occupiedNights,
      occupiedNightsOverride: override,
      effectiveOccupiedNights: effectiveNights,
      lines,
    };
  }

  /** Vista previa (no escribe). Si ya hay control de esa semana lo indica. */
  async preview(warehouseId: string, weekFrom: string) {
    const calc = await this.compute(warehouseId, weekFrom);
    const existing = await this.db.hotelAmenityWeeklyControl.findUnique({
      where: { warehouseId_weekFrom: { warehouseId, weekFrom: dateOnly(calc.weekFrom) } },
      select: { id: true, folio: true, status: true },
    });
    return { ...calc, existing };
  }

  /** Guarda (o actualiza) el borrador con los finales capturados y el override. */
  async saveDraft(input: HotelAmenityControlSaveInput, actorId: string) {
    const finals = new Map(input.lines.map((l) => [l.productId, l.finalStock]));
    const calc = await this.compute(input.warehouseId, input.weekFrom, finals, input.occupiedNightsOverride ?? null);
    const id = await runSerializable(async (tx) => {
      const existing = await tx.hotelAmenityWeeklyControl.findUnique({
        where: { warehouseId_weekFrom: { warehouseId: input.warehouseId, weekFrom: dateOnly(calc.weekFrom) } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== "DRAFT") throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
      const data = this.snapshot(calc, input.notes ?? null);
      if (existing) {
        await tx.hotelAmenityWeeklyLine.deleteMany({ where: { controlId: existing.id } });
        await tx.hotelAmenityWeeklyControl.update({ where: { id: existing.id }, data });
        return existing.id;
      }
      const count = await tx.hotelAmenityWeeklyControl.count();
      const created = await tx.hotelAmenityWeeklyControl.create({
        data: { ...data, folio: `CA-${String(count + 1).padStart(4, "0")}`, warehouseId: input.warehouseId, weekFrom: dateOnly(calc.weekFrom), weekTo: dateOnly(calc.weekTo) },
      });
      return created.id;
    }, this.db);
    await this.log("HOTEL_LINEN_AMENITY_CONTROL_SAVED", id, actorId, {}, { warehouse: input.warehouseId, weekFrom: calc.weekFrom, lines: calc.lines.length });
    return this.get(id);
  }

  /** DRAFT -> SUBMITTED: recalcula con los finales capturados, deja la fotografía y firma "elabora". */
  async submit(id: string, actorId: string) {
    const control = await this.header(id);
    if (control.status !== "DRAFT") throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
    const saved = await this.db.hotelAmenityWeeklyLine.findMany({ where: { controlId: id }, select: { productId: true, finalStock: true } });
    const calc = await this.compute(control.warehouseId, keyOf(control.weekFrom), new Map(saved.map((l) => [l.productId, Number(l.finalStock)])), control.occupiedNightsOverride);
    await runSerializable(async (tx) => {
      const moved = await tx.hotelAmenityWeeklyControl.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SUBMITTED" } });
      if (moved.count === 0) throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
      await tx.hotelAmenityWeeklyLine.deleteMany({ where: { controlId: id } });
      await tx.hotelAmenityWeeklyControl.update({ where: { id }, data: this.snapshot(calc, control.notes) });
      await this.signatures.sign(AMENITY_CONTROL_DOC, id, "CONFIRMS", actorId, "SESSION", tx);
    }, this.db);
    await this.log("HOTEL_LINEN_AMENITY_CONTROL_SUBMITTED", id, actorId, { status: "DRAFT" }, { status: "SUBMITTED", folio: control.folio });
    return this.get(id);
  }

  /** SUBMITTED -> REVIEWED (Supervisora general). Con alguna línea > 10% avisa al Gerente de Operaciones. */
  async review(id: string, caller: Caller) {
    if (!hasAnyRole(caller.roles, REVIEW_ROLES)) throw new HttpError(403, "HOTEL_AMENITY_ROLE_FORBIDDEN");
    const control = await this.header(id);
    if (control.status !== "SUBMITTED") throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
    await runSerializable(async (tx) => {
      const moved = await tx.hotelAmenityWeeklyControl.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "REVIEWED" } });
      if (moved.count === 0) throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
      await this.signatures.sign(AMENITY_CONTROL_DOC, id, "REVIEWS", caller.id, "SESSION", tx);
    }, this.db);
    await this.log("HOTEL_LINEN_AMENITY_CONTROL_REVIEWED", id, caller.id, { status: "SUBMITTED" }, { status: "REVIEWED", flaggedLines: control.flaggedLines });
    if (control.flaggedLines > 0) await this.notifyVariance(id);
    return this.get(id);
  }

  /** REVIEWED -> ACKNOWLEDGED (Gerente de Operaciones, "enterado"). */
  async acknowledge(id: string, caller: Caller) {
    if (!hasAnyRole(caller.roles, ACKNOWLEDGE_ROLES)) throw new HttpError(403, "HOTEL_AMENITY_ROLE_FORBIDDEN");
    const control = await this.header(id);
    if (control.status !== "REVIEWED") throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
    await runSerializable(async (tx) => {
      const moved = await tx.hotelAmenityWeeklyControl.updateMany({ where: { id, status: "REVIEWED" }, data: { status: "ACKNOWLEDGED" } });
      if (moved.count === 0) throw new HttpError(409, "HOTEL_AMENITY_CONTROL_INVALID_STATE");
      await this.signatures.sign(AMENITY_CONTROL_DOC, id, "AUTHORIZES", caller.id, "SESSION", tx);
    }, this.db);
    await this.log("HOTEL_LINEN_AMENITY_CONTROL_ACKNOWLEDGED", id, caller.id, { status: "REVIEWED" }, { status: "ACKNOWLEDGED" });
    return this.get(id);
  }

  /** Tabla server-side. Filtros: status, area, folio, week (rango de weekFrom). `visibleIds` null = todos. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const area = filterId(f, "area");
    const folio = filterText(f, "folio");
    const week = filterDateRange(f, "week");
    const where: Prisma.HotelAmenityWeeklyControlWhereInput = {
      ...(status ? { status: status as HotelAmenityControlStatus } : {}),
      ...(area ? { warehouseId: area } : {}),
      ...(folio ? { folio } : {}),
      ...(week ? { weekFrom: week } : {}),
      ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", week: "weekFrom", status: "status" }, [{ weekFrom: "desc" }]) as Prisma.HotelAmenityWeeklyControlOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelAmenityWeeklyControl.findMany({
        where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit,
        include: { warehouse: { select: WAREHOUSE_SELECT }, _count: { select: { lines: true } } },
      }),
      this.db.hotelAmenityWeeklyControl.count({ where }),
    ]);
    return {
      total,
      data: rows.map((r) => ({
        id: r.id, folio: r.folio, status: r.status, area: r.warehouse, weekFrom: r.weekFrom, weekTo: r.weekTo,
        occupiedNights: r.occupiedNightsOverride ?? r.occupiedNights, lines: r._count.lines, flaggedLines: r.flaggedLines,
      })),
    };
  }

  async get(id: string) {
    const r = await this.db.hotelAmenityWeeklyControl.findUnique({
      where: { id },
      include: { warehouse: { select: WAREHOUSE_SELECT }, lines: { include: { product: { select: PRODUCT_SELECT } }, orderBy: { product: { code: "asc" } } } },
    });
    if (!r) throw new HttpError(404, "HOTEL_AMENITY_CONTROL_NOT_FOUND");
    const signatures = await this.signatures.list(AMENITY_CONTROL_DOC, id);
    return {
      id: r.id, folio: r.folio, status: r.status, area: r.warehouse, warehouseId: r.warehouseId,
      weekFrom: keyOf(r.weekFrom), weekTo: keyOf(r.weekTo),
      occupiedNights: r.occupiedNights, occupiedNightsOverride: r.occupiedNightsOverride,
      effectiveOccupiedNights: r.occupiedNightsOverride ?? r.occupiedNights,
      notes: r.notes, flaggedLines: r.flaggedLines,
      lines: r.lines.map((l) => {
        const result = { realConsumption: num(l.realConsumption), expectedConsumption: num(l.expectedConsumption), diffPct: l.diffPct === null ? null : num(l.diffPct) };
        return {
          product: { id: l.product.id, code: l.product.code, name: l.product.name, unit: l.product.unit.name },
          standardPerRoom: num(l.standardPerRoom), initialStock: num(l.initialStock), supplied: num(l.supplied), extras: num(l.extras),
          finalStock: num(l.finalStock), systemFinalStock: num(l.finalStock), ...result, flagged: exceedsThreshold(result),
        } satisfies AmenityLine;
      }),
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Cabecera para decidir alcance y estado antes de operar. */
  async header(id: string) {
    const r = await this.db.hotelAmenityWeeklyControl.findUnique({
      where: { id },
      select: { id: true, folio: true, warehouseId: true, weekFrom: true, status: true, occupiedNightsOverride: true, notes: true, flaggedLines: true },
    });
    if (!r) throw new HttpError(404, "HOTEL_AMENITY_CONTROL_NOT_FOUND");
    return r;
  }

  /**
   * Productos CONSUMABLE de la bodega de amenidades (código AME) con saldo <= mínimo. Mínimo = límite del
   * almacén (`HotelWarehouseProductLimit`) o, si no hay, `HotelProduct.minStock`. F6 genera la reposición con esto.
   */
  async amenityLowStock() {
    const warehouses = await this.db.hotelWarehouse.findMany({ where: { kind: "CENTRAL", code: AMENITY_WAREHOUSE_CODE, active: true }, select: WAREHOUSE_SELECT });
    if (warehouses.length === 0) return [];
    const ids = warehouses.map((w) => w.id);
    const [products, stock, limits] = await Promise.all([
      this.db.hotelProduct.findMany({ where: { kind: "CONSUMABLE", active: true }, select: { ...PRODUCT_SELECT, minStock: true }, orderBy: { code: "asc" } }),
      this.db.hotelStock.groupBy({ by: ["warehouseId", "productId"], where: { warehouseId: { in: ids }, product: { kind: "CONSUMABLE" } }, _sum: { quantity: true } }),
      this.db.hotelWarehouseProductLimit.findMany({ where: { warehouseId: { in: ids } } }),
    ]);
    const stockOf = new Map(stock.map((s) => [`${s.warehouseId}:${s.productId}`, num(s._sum.quantity)]));
    const limitOf = new Map(limits.map((l) => [`${l.warehouseId}:${l.productId}`, l]));
    const out: Array<{ warehouse: (typeof warehouses)[number]; product: { id: string; code: string; name: string; unit: string }; stock: number; minStock: number; maxStock: number; suggested: number }> = [];
    for (const warehouse of warehouses) {
      for (const p of products) {
        const limit = limitOf.get(`${warehouse.id}:${p.id}`);
        const min = limit ? num(limit.minStock) : num(p.minStock);
        const max = limit ? num(limit.maxStock) : 0;
        const onHand = stockOf.get(`${warehouse.id}:${p.id}`) ?? 0;
        if (!atOrBelowMin(onHand, min)) continue;
        out.push({
          warehouse, product: { id: p.id, code: p.code, name: p.name, unit: p.unit.name },
          stock: onHand, minStock: min, maxStock: max, suggested: max > onHand ? max - onHand : 0,
        });
      }
    }
    return out;
  }

  /**
   * Toallas del Spa del día: entregadas (traspasos de lavandería recibidos), sucias devueltas (recepciones de
   * sucios con origen SPA), en uso (lo que reporta la recepción; sin recepción, entregadas - devueltas) y faltante.
   */
  async spaDaily(dateKey?: string | null) {
    const spa = await this.db.hotelWarehouse.findFirst({ where: { kind: "SPA", active: true }, orderBy: { code: "asc" }, select: WAREHOUSE_SELECT });
    const { from, to } = dayRange(dateKey);
    const date = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    if (!spa) return { date, warehouse: null, totals: { delivered: 0, returnedDirty: 0, inUse: 0, shortage: 0 }, rows: [] };
    const [transfers, receiptLines, stock] = await Promise.all([
      this.db.hotelMovement.findMany({
        where: {
          type: "TRANSFER", warehouseId: spa.id, fromWarehouse: { is: { kind: "LAUNDRY" } },
          status: { in: ["ACTIVE", "RECEIVED_WITH_DIFFERENCE"] }, receivedAt: { gte: from, lt: to },
        },
        select: { lines: { select: { productId: true, quantity: true, receivedQuantity: true } } },
      }),
      this.db.hotelDirtyReceiptLine.findMany({
        where: { receipt: { originWarehouseId: spa.id, date: { gte: from, lt: to } } },
        select: { productId: true, receivedDirty: true, stillInUse: true, shortage: true },
      }),
      this.db.hotelStock.groupBy({ by: ["productId"], where: { warehouseId: spa.id }, _sum: { quantity: true } }),
    ]);
    type Row = { productId: string; delivered: number; returnedDirty: number; stillInUse: number; shortage: number; hasReceipt: boolean; onHand: number };
    const rows = new Map<string, Row>();
    const row = (productId: string): Row => {
      let r = rows.get(productId);
      if (!r) rows.set(productId, (r = { productId, delivered: 0, returnedDirty: 0, stillInUse: 0, shortage: 0, hasReceipt: false, onHand: 0 }));
      return r;
    };
    for (const t of transfers) for (const l of t.lines) row(l.productId).delivered += num(l.receivedQuantity ?? l.quantity);
    for (const l of receiptLines) {
      const r = row(l.productId);
      r.returnedDirty += num(l.receivedDirty);
      r.stillInUse += num(l.stillInUse);
      r.shortage += num(l.shortage);
      r.hasReceipt = true;
    }
    for (const s of stock) if (rows.has(s.productId)) rows.get(s.productId)!.onHand = num(s._sum.quantity);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: [...rows.keys()] } }, select: PRODUCT_SELECT, orderBy: { code: "asc" } });
    const data = products.map((p) => {
      const r = rows.get(p.id)!;
      return {
        product: { id: p.id, code: p.code, name: p.name, unit: p.unit.name },
        delivered: r.delivered, returnedDirty: r.returnedDirty,
        inUse: r.hasReceipt ? r.stillInUse : Math.max(r.delivered - r.returnedDirty, 0),
        shortage: r.shortage, onHand: r.onHand,
      };
    });
    const sum = (key: "delivered" | "returnedDirty" | "inUse" | "shortage") => data.reduce((s, x) => s + x[key], 0);
    return {
      date, warehouse: spa,
      totals: { delivered: sum("delivered"), returnedDirty: sum("returnedDirty"), inUse: sum("inUse"), shortage: sum("shortage") },
      rows: data,
    };
  }

  private snapshot(calc: Awaited<ReturnType<HotelAmenityService["compute"]>>, notes: string | null) {
    return {
      occupiedNights: calc.occupiedNights,
      occupiedNightsOverride: calc.occupiedNightsOverride,
      notes,
      flaggedLines: calc.lines.filter((l) => l.flagged).length,
      lines: {
        create: calc.lines.map((l) => ({
          productId: l.product.id, standardPerRoom: l.standardPerRoom, initialStock: l.initialStock, supplied: l.supplied, extras: l.extras,
          finalStock: l.finalStock, realConsumption: l.realConsumption, expectedConsumption: l.expectedConsumption, diffPct: l.diffPct,
        })),
      },
    };
  }

  /** Avisa al Gerente de Operaciones que hay diferencias > 10%. El aviso es secundario. */
  private async notifyVariance(id: string) {
    if (!this.notifications) return;
    try {
      const control = await this.get(id);
      const users = await this.db.user.findMany({
        where: { active: true, OR: [{ role: "HOTEL_OPS_MANAGER" }, { extraRoles: { some: { role: "HOTEL_OPS_MANAGER" } } }] },
        select: { id: true },
      });
      const detail = control.lines.filter((l) => l.flagged).map((l) => `${l.product.code}: ${l.diffPct === null ? "s/e" : `${l.diffPct}%`}`).join(", ");
      await this.notifications.createManyNotifications(
        users.map((u) => ({
          userId: u.id,
          type: "HOTEL_AMENITY_VARIANCE",
          title: `Diferencia de amenidades > 10% en ${control.area.name} (${control.folio})`,
          detail,
        }))
      );
    } catch {
      // Un fallo de notificación no revierte la revisión.
    }
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({ action, entityType: "HotelAmenityControl", entityId: id, userId: actorId, previousState, newState });
  }
}
