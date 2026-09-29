import { Prisma, type KitchenMovementType, type PrismaClient, type PurchaseOrderStatus } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { localDateKey, resolveTimezoneWithConfig } from "@core/utils/timezone";
import {
  filterBool,
  filterDateRange,
  filterDayRange,
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import {
  KITCHEN_ITEM_KINDS,
  KITCHEN_MOVEMENT_TYPES,
  KITCHEN_STORAGES,
  type KitchenAdjustmentInput,
  type KitchenFefoPreviewInput,
  type KitchenStockInInput,
  type KitchenStockOutInput,
} from "../models/dto/kitchen.dto";
import { allocateFefo, isExpired, round3, type FefoLot } from "./fefo";
import { kitchenLedgerSign } from "./ledger";
import { LOT_STATUSES, STOCK_STATUSES, addDays, lotStatus, stockStatus, suggestedQuantity } from "./stock";

type Tx = Prisma.TransactionClient;
type SysConfigReader = (key: string) => Promise<string | null>;

/** Proyección de la unidad de medida del artículo (catálogo). */
const unitSelect = { select: { id: true, code: true, name: true, whole: true } } as const;

/** Días de aviso antes de la caducidad (sys_config); default 3. */
export const EXPIRY_WARNING_DAYS_CONFIG_KEY = "KITCHEN_EXPIRY_WARNING_DAYS";
const DEFAULT_WARNING_DAYS = 3;
const MAX_TX_ATTEMPTS = 3;

const dec = (n: number) => new Prisma.Decimal(n.toFixed(3));
const num = (d: Prisma.Decimal) => d.toNumber();
const numOrNull = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
/** `@db.Date` → clave `YYYY-MM-DD` (se guarda a medianoche UTC). */
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Conflictos que se resuelven repitiendo la transacción: choque Serializable
 * (P2034) o dos entradas que generaron el mismo código de lote (P2002 sobre
 * `lotCode`).
 */
const isRetryableConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  (err.code === "P2034" ||
    (err.code === "P2002" && ([] as string[]).concat((err.meta?.target as string[] | string) ?? []).includes("lotCode")));

const lineInclude = {
  item: { select: { id: true, code: true, name: true, unit: unitSelect } },
  lot: { select: { id: true, lotCode: true, expiresAt: true } },
} as const;

const movementInclude = {
  createdBy: { select: { id: true, name: true } },
  lines: { include: lineInclude },
} as const;

type MovementWithLines = Prisma.KitchenMovementGetPayload<{ include: typeof movementInclude }>;

const serializeMovement = (m: MovementWithLines) => ({
  id: m.id,
  type: m.type,
  date: m.date.toISOString(),
  status: m.status,
  reference: m.reference,
  notes: m.notes,
  wasteReason: m.wasteReason,
  reversalOfId: m.reversalOfId,
  createdBy: m.createdBy,
  lines: m.lines.map((l) => ({
    id: l.id,
    item: l.item,
    lot: { id: l.lot.id, lotCode: l.lot.lotCode, expiresAt: dayOf(l.lot.expiresAt) },
    quantity: num(l.quantity),
    unitCost: numOrNull(l.unitCost),
  })),
});

interface LineToApply {
  itemId: string;
  lotId: string;
  quantity: number;
  unitCost?: number | null;
}

/**
 * Existencias del almacén de cocina: lotes, movimientos (una sola regla de
 * kardex, `kitchenLedgerSign`), reparto FEFO, reabastecimiento y alertas.
 *
 * Cada operación que mueve existencias corre Serializable con reintento y
 * descuenta con una actualización condicionada (`onHand >= cantidad`), así que
 * ningún lote queda negativo aunque dos personas registren al mismo tiempo.
 */
export class KitchenStockService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  // --- contexto: hoy y días de aviso ------------------------------------------

  private async today(): Promise<string> {
    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    return localDateKey(new Date(), timezone);
  }

  private async warningDays(): Promise<number> {
    const raw = await this.sysConfig?.(EXPIRY_WARNING_DAYS_CONFIG_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_WARNING_DAYS;
  }

  // --- existencias por artículo -----------------------------------------------

  /** Disponible (lotes vigentes), caducado y próxima caducidad por artículo. */
  async availability(itemIds: string[], today: string) {
    const lots = await this.db.kitchenLot.findMany({
      where: { itemId: { in: itemIds }, onHand: { gt: 0 } },
      select: { itemId: true, onHand: true, expiresAt: true },
    });
    const out = new Map<string, { available: number; expired: number; nextExpiry: string | null }>();
    for (const id of itemIds) out.set(id, { available: 0, expired: 0, nextExpiry: null });
    for (const lot of lots) {
      const entry = out.get(lot.itemId)!;
      const day = dayOf(lot.expiresAt);
      if (isExpired(day, today)) {
        entry.expired = round3(entry.expired + num(lot.onHand));
      } else {
        entry.available = round3(entry.available + num(lot.onHand));
        if (day && (!entry.nextExpiry || day < entry.nextExpiry)) entry.nextExpiry = day;
      }
    }
    return out;
  }

  /**
   * Tabla de artículos con su existencia. El estado de stock (bajo mínimo /
   * sobre máximo) se calcula con los lotes, así que el filtro y el orden por
   * esas columnas se resuelven en memoria sobre los artículos que ya pasaron
   * los filtros de la base (el catálogo de cocina es de cientos, no de miles).
   */
  async itemsTable(params: ITDataTableFetchParams) {
    const f = params.filters;
    const where: Prisma.KitchenItemWhereInput = {
      code: filterText(f, "code"),
      name: filterText(f, "name"),
      categoryId: filterId(f, "categoryId"),
      kind: filterEnum(f, "kind", KITCHEN_ITEM_KINDS),
      unitId: filterId(f, "unitId"),
      storage: filterEnum(f, "storage", KITCHEN_STORAGES),
      tracksExpiry: filterBool(f, "tracksExpiry"),
      active: filterBool(f, "active"),
    };
    const status = filterEnum(f, "stockStatus", STOCK_STATUSES);
    const today = await this.today();
    const items = await this.db.kitchenItem.findMany({
      where,
      include: { category: { select: { id: true, name: true } }, unit: unitSelect },
      orderBy: orderByOf(params.sort, { code: "code", name: "name", kind: "kind", unit: (d) => ({ unit: { name: d } }), storage: "storage", minStock: "minStock", maxStock: "maxStock", category: (d) => ({ category: { name: d } }) }, [{ name: "asc" }]) as Prisma.KitchenItemOrderByWithRelationInput[],
    });
    const stock = await this.availability(items.map((i) => i.id), today);
    let rows = items.map((i) => {
      const s = stock.get(i.id)!;
      const minStock = num(i.minStock);
      const maxStock = numOrNull(i.maxStock);
      return {
        id: i.id,
        code: i.code,
        name: i.name,
        category: i.category,
        kind: i.kind,
        unit: i.unit,
        storage: i.storage,
        tracksExpiry: i.tracksExpiry,
        minStock,
        maxStock,
        active: i.active,
        available: s.available,
        expired: s.expired,
        nextExpiry: s.nextExpiry,
        stockStatus: stockStatus(s.available, minStock, maxStock),
      };
    });
    if (status) rows = rows.filter((r) => r.stockStatus === status);
    const sortKey = params.sort?.key;
    if (sortKey === "available" || sortKey === "nextExpiry" || sortKey === "stockStatus") {
      const dir = params.sort!.direction === "desc" ? -1 : 1;
      const val = (r: (typeof rows)[number]) => (sortKey === "available" ? r.available : sortKey === "nextExpiry" ? r.nextExpiry ?? "9999" : STOCK_STATUSES.indexOf(r.stockStatus));
      rows.sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
    }
    const start = (params.page - 1) * params.limit;
    return { data: rows.slice(start, start + params.limit), total: rows.length };
  }

  /** Detalle del artículo: existencia, lotes con saldo y últimos movimientos. */
  async itemDetail(id: string) {
    const item = await this.db.kitchenItem.findUnique({ where: { id }, include: { category: { select: { id: true, name: true } }, unit: unitSelect } });
    if (!item) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
    const [today, warningDays] = await Promise.all([this.today(), this.warningDays()]);
    const [stock, lots, lines] = await Promise.all([
      this.availability([id], today),
      this.db.kitchenLot.findMany({
        where: { itemId: id, onHand: { gt: 0 } },
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.db.kitchenMovementLine.findMany({
        where: { itemId: id },
        orderBy: { movement: { date: "desc" } },
        take: 20,
        include: { lot: { select: { lotCode: true } }, movement: { select: { id: true, type: true, date: true, status: true, wasteReason: true, createdBy: { select: { name: true } } } } },
      }),
    ]);
    const s = stock.get(id)!;
    const minStock = num(item.minStock);
    const maxStock = numOrNull(item.maxStock);
    return {
      ...item,
      minStock,
      maxStock,
      available: s.available,
      expired: s.expired,
      nextExpiry: s.nextExpiry,
      stockStatus: stockStatus(s.available, minStock, maxStock),
      suggested: suggestedQuantity(s.available, minStock, maxStock, item.unit),
      lots: lots.map((l) => ({
        id: l.id,
        lotCode: l.lotCode,
        expiresAt: dayOf(l.expiresAt),
        receivedAt: l.receivedAt.toISOString(),
        supplier: l.supplier,
        unitCost: numOrNull(l.unitCost),
        quantityIn: num(l.quantityIn),
        onHand: num(l.onHand),
        status: lotStatus(num(l.onHand), dayOf(l.expiresAt), today, warningDays),
      })),
      movements: lines.map((l) => ({
        movementId: l.movement.id,
        type: l.movement.type,
        status: l.movement.status,
        wasteReason: l.movement.wasteReason,
        date: l.movement.date.toISOString(),
        createdBy: l.movement.createdBy.name,
        lotCode: l.lot.lotCode,
        quantity: num(l.quantity),
      })),
    };
  }

  // --- lotes ------------------------------------------------------------------

  /** Existencias por lote. El estado (vigente/por caducar/caducado/agotado) se traduce a condiciones de la base. */
  async lotsTable(params: ITDataTableFetchParams) {
    const f = params.filters;
    const [today, warningDays] = await Promise.all([this.today(), this.warningDays()]);
    const status = filterEnum(f, "status", LOT_STATUSES);
    const itemText = filterText(f, "item");
    const and: Prisma.KitchenLotWhereInput[] = [];
    if (itemText) and.push({ OR: [{ item: { name: itemText } }, { item: { code: itemText } }] });
    const todayDate = dateOfDay(today);
    const limitDate = dateOfDay(addDays(today, warningDays));
    if (status === "EMPTY") and.push({ onHand: { lte: 0 } });
    if (status === "EXPIRED") and.push({ onHand: { gt: 0 }, expiresAt: { lt: todayDate } });
    if (status === "EXPIRING") and.push({ onHand: { gt: 0 }, expiresAt: { gte: todayDate, lte: limitDate } });
    if (status === "VALID") and.push({ onHand: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: limitDate } }] });
    const where: Prisma.KitchenLotWhereInput = {
      itemId: filterId(f, "itemId"),
      lotCode: filterText(f, "lotCode"),
      expiresAt: filterDayRange(f, "expiresAt"),
      receivedAt: filterDateRange(f, "receivedAt"),
      supplierId: filterId(f, "supplierId"),
      item: { categoryId: filterId(f, "categoryId") },
      AND: and,
    };
    const orderBy = orderByOf(
      params.sort,
      {
        lotCode: "lotCode",
        receivedAt: "receivedAt",
        onHand: "onHand",
        quantityIn: "quantityIn",
        expiresAt: (d) => ({ expiresAt: { sort: d, nulls: "last" } }),
        item: (d) => ({ item: { name: d } }),
        supplier: (d) => ({ supplier: { name: d } }),
      },
      [{ expiresAt: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }]
    ) as Prisma.KitchenLotOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.kitchenLot.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          item: { select: { id: true, code: true, name: true, unit: unitSelect, category: { select: { id: true, name: true } } } },
          supplier: { select: { id: true, name: true } },
        },
      }),
      this.db.kitchenLot.count({ where }),
    ]);
    return {
      data: rows.map((l) => ({
        id: l.id,
        lotCode: l.lotCode,
        item: l.item,
        supplier: l.supplier,
        expiresAt: dayOf(l.expiresAt),
        receivedAt: l.receivedAt.toISOString(),
        quantityIn: num(l.quantityIn),
        onHand: num(l.onHand),
        unitCost: numOrNull(l.unitCost),
        status: lotStatus(num(l.onHand), dayOf(l.expiresAt), today, warningDays),
      })),
      total,
    };
  }

  // --- movimientos --------------------------------------------------------------

  /** Kardex: movimientos con sus líneas (lote exacto). */
  async movementsTable(params: ITDataTableFetchParams) {
    const f = params.filters;
    const itemText = filterText(f, "item");
    const createdBy = filterText(f, "createdBy");
    const itemId = filterId(f, "itemId");
    const where: Prisma.KitchenMovementWhereInput = {
      type: filterEnum(f, "type", KITCHEN_MOVEMENT_TYPES),
      status: filterEnum(f, "status", ["ACTIVE", "CANCELLED"] as const),
      date: filterDateRange(f, "date"),
      reference: filterText(f, "reference"),
      ...(createdBy && { createdBy: { name: createdBy } }),
      AND: [
        ...(itemText ? [{ lines: { some: { OR: [{ item: { name: itemText } }, { item: { code: itemText } }] } } }] : []),
        ...(itemId ? [{ lines: { some: { itemId } } }] : []),
      ],
    };
    const orderBy = orderByOf(params.sort, { date: "date", type: "type", status: "status", reference: "reference", createdBy: (d) => ({ createdBy: { name: d } }) }, [{ date: "desc" }]) as Prisma.KitchenMovementOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.kitchenMovement.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: movementInclude }),
      this.db.kitchenMovement.count({ where }),
    ]);
    return { data: rows.map(serializeMovement), total };
  }

  async movement(id: string) {
    const m = await this.db.kitchenMovement.findUnique({ where: { id }, include: movementInclude });
    if (!m) throw new HttpError(404, "KITCHEN_MOVEMENT_NOT_FOUND");
    return serializeMovement(m);
  }

  /** Entrada: cada renglón crea un lote; los perecederos exigen caducidad. */
  stockIn(input: KitchenStockInInput, actorId: string, requestId?: string, purchaseOrderId?: string) {
    return this.register(requestId, actorId, async (tx) => {
      if (input.supplierId) {
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
      }
      const items = await this.activeItems(tx, input.lines.map((l) => l.itemId));
      const receivedAt = input.date ? new Date(input.date) : new Date();
      const lines: LineToApply[] = [];
      for (const line of input.lines) {
        const item = items.get(line.itemId)!;
        if (item.tracksExpiry && !line.expiresAt) throw new HttpError(400, "EXPIRY_REQUIRED", { item: item.name });
        const lotCode = line.lotCode?.toUpperCase() ?? (await this.nextLotCode(tx, item.id, receivedAt));
        const clash = await tx.kitchenLot.findUnique({ where: { itemId_lotCode: { itemId: item.id, lotCode } } });
        if (clash) throw new HttpError(409, "LOT_CODE_TAKEN", { lot: lotCode, item: item.name });
        const lot = await tx.kitchenLot.create({
          data: {
            itemId: item.id,
            lotCode,
            expiresAt: line.expiresAt ? dateOfDay(line.expiresAt) : null,
            receivedAt,
            supplierId: input.supplierId ?? null,
            unitCost: line.unitCost == null ? null : new Prisma.Decimal(line.unitCost),
            quantityIn: dec(line.quantity),
            onHand: dec(0),
          },
        });
        lines.push({ itemId: item.id, lotId: lot.id, quantity: line.quantity, unitCost: line.unitCost ?? null });
      }
      return this.createMovement(tx, "STOCK_IN", lines, actorId, { ...input, purchaseOrderId });
    });
  }

  /**
   * Consumo o merma. Sin lote, reparte por FEFO; con lote, usa ese. Un consumo
   * nunca toma lotes caducados ni artículos duraderos (esos solo salen por
   * merma); una merma sí puede sacar lo caducado.
   */
  stockOut(input: KitchenStockOutInput, actorId: string, requestId?: string) {
    if (input.type === "WASTE" && !input.wasteReason) throw new HttpError(400, "WASTE_REASON_REQUIRED");
    if (input.type === "CONSUMPTION" && input.wasteReason) throw new HttpError(400, "INVALID_MOVEMENT");
    return this.register(requestId, actorId, async (tx) => {
      const today = await this.today();
      const items = await this.activeItems(tx, input.lines.map((l) => l.itemId));
      const lines: LineToApply[] = [];
      for (const line of input.lines) {
        const item = items.get(line.itemId)!;
        if (input.type === "CONSUMPTION" && item.kind === "DURABLE") throw new HttpError(400, "DURABLE_NOT_CONSUMABLE", { item: item.name });
        if (line.lotId) {
          const lot = await this.lotOfItem(tx, line.lotId, item.id);
          if (input.type === "CONSUMPTION" && isExpired(dayOf(lot.expiresAt), today)) throw new HttpError(409, "LOT_EXPIRED", { lot: lot.lotCode });
          lines.push({ itemId: item.id, lotId: lot.id, quantity: line.quantity });
          continue;
        }
        const plan = allocateFefo(await this.fefoLots(tx, item.id), line.quantity, today, { includeExpired: input.type === "WASTE" });
        if (plan.missing > 0) throw new HttpError(409, "INSUFFICIENT_STOCK", { item: item.name, missing: plan.missing });
        for (const a of plan.allocations) lines.push({ itemId: item.id, lotId: a.lotId, quantity: a.quantity });
      }
      return this.createMovement(tx, input.type, lines, actorId, input, input.wasteReason);
    });
  }

  /** Ajuste por conteo físico sobre lotes existentes (sobrante o faltante). */
  adjust(input: KitchenAdjustmentInput, actorId: string, requestId?: string) {
    return this.register(requestId, actorId, async (tx) => {
      await this.activeItems(tx, input.lines.map((l) => l.itemId), { allowInactive: true });
      const lines: LineToApply[] = [];
      for (const line of input.lines) {
        await this.lotOfItem(tx, line.lotId, line.itemId);
        lines.push({ itemId: line.itemId, lotId: line.lotId, quantity: line.quantity });
      }
      return this.createMovement(tx, input.type, lines, actorId, input);
    });
  }

  /** Reparto FEFO sugerido (no escribe): lo que la pantalla muestra antes de confirmar. */
  async fefoPreview(input: KitchenFefoPreviewInput) {
    const today = await this.today();
    const items = await this.activeItems(this.db, input.lines.map((l) => l.itemId));
    const out = [];
    for (const line of input.lines) {
      const item = items.get(line.itemId)!;
      const plan = allocateFefo(await this.fefoLots(this.db, item.id), line.quantity, today, { includeExpired: input.type === "WASTE" });
      out.push({ itemId: item.id, code: item.code, name: item.name, unit: item.unit, quantity: line.quantity, ...plan });
    }
    return { today, lines: out };
  }

  /**
   * Reversión: registra lo contrario del movimiento y lo deja CANCELLED. No se
   * puede revertir una entrada si parte de ese lote ya salió (quedaría negativo).
   */
  reverse(id: string, notes: string | null | undefined, actorId: string, requestId?: string) {
    return this.register(requestId, actorId, async (tx) => {
      const source = await tx.kitchenMovement.findUnique({ where: { id }, include: { lines: true, reversals: { select: { id: true } } } });
      if (!source) throw new HttpError(404, "KITCHEN_MOVEMENT_NOT_FOUND");
      if (source.type === "REVERSAL") throw new HttpError(409, "MOVEMENT_NOT_REVERSIBLE");
      if (source.status !== "ACTIVE" || source.reversals.length > 0) throw new HttpError(409, "MOVEMENT_ALREADY_REVERSED");
      await tx.kitchenMovement.update({ where: { id }, data: { status: "CANCELLED" } });
      const lines = source.lines.map((l) => ({ itemId: l.itemId, lotId: l.lotId, quantity: num(l.quantity), unitCost: numOrNull(l.unitCost) }));
      return this.createMovement(tx, "REVERSAL", lines, actorId, { notes, reference: source.reference }, null, source.type, source.id);
    });
  }

  // --- reabastecimiento y alertas ---------------------------------------------

  /** Estados de OC que cuentan como "en tránsito" (aprobadas, enviadas o parciales). */
  static readonly OPEN_PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
    "APPROVED",
    "SENT",
    "PARTIALLY_RECEIVED",
  ];

  /** Cantidad en tránsito por artículo (lo pedido menos lo ya recibido). */
  async inTransitByItem(): Promise<Map<string, number>> {
    const lines = await this.db.purchaseOrderLine.findMany({
      where: { purchaseOrder: { status: { in: KitchenStockService.OPEN_PURCHASE_ORDER_STATUSES } } },
      select: { itemId: true, quantity: true, receivedQuantity: true },
    });
    const out = new Map<string, number>();
    for (const line of lines) {
      out.set(line.itemId, round3((out.get(line.itemId) ?? 0) + num(line.quantity) - num(line.receivedQuantity)));
    }
    return out;
  }

  /** Artículos activos bajo mínimo con el sugerido a pedir (máx − disponible − en tránsito). */
  async restock() {
    const today = await this.today();
    const items = await this.db.kitchenItem.findMany({
      where: { active: true },
      include: { category: { select: { id: true, name: true } }, unit: unitSelect },
      orderBy: { name: "asc" },
    });
    const [stock, inTransit] = await Promise.all([
      this.availability(items.map((i) => i.id), today),
      this.inTransitByItem(),
    ]);
    return items
      .map((i) => {
        const s = stock.get(i.id)!;
        const minStock = num(i.minStock);
        const maxStock = numOrNull(i.maxStock);
        const transit = inTransit.get(i.id) ?? 0;
        return {
          id: i.id,
          code: i.code,
          name: i.name,
          category: i.category,
          unit: i.unit,
          available: s.available,
          inTransit: transit,
          minStock,
          maxStock,
          stockStatus: stockStatus(s.available, minStock, maxStock),
          suggested: suggestedQuantity(round3(s.available + transit), minStock, maxStock, i.unit),
        };
      })
      .filter((r) => r.stockStatus === "LOW" && r.suggested > 0);
  }

  /** Conteos y listas para el tablero: bajo mínimo, sobre máximo, por caducar y caducados. */
  async alerts() {
    const [today, warningDays] = await Promise.all([this.today(), this.warningDays()]);
    const items = await this.db.kitchenItem.findMany({ where: { active: true }, select: { id: true, code: true, name: true, unit: unitSelect, minStock: true, maxStock: true } });
    const stock = await this.availability(items.map((i) => i.id), today);
    const withStatus = items.map((i) => {
      const s = stock.get(i.id)!;
      return { id: i.id, code: i.code, name: i.name, unit: i.unit, available: s.available, minStock: num(i.minStock), maxStock: numOrNull(i.maxStock), stockStatus: stockStatus(s.available, num(i.minStock), numOrNull(i.maxStock)) };
    });
    const lots = await this.db.kitchenLot.findMany({
      where: { onHand: { gt: 0 }, expiresAt: { not: null, lte: dateOfDay(addDays(today, warningDays)) }, item: { active: true } },
      orderBy: { expiresAt: "asc" },
      include: { item: { select: { id: true, code: true, name: true, unit: unitSelect } } },
    });
    const lotRows = lots.map((l) => ({ id: l.id, lotCode: l.lotCode, item: l.item, expiresAt: dayOf(l.expiresAt), onHand: num(l.onHand) }));
    const expired = lotRows.filter((l) => l.expiresAt! < today);
    const expiring = lotRows.filter((l) => l.expiresAt! >= today);
    const low = withStatus.filter((r) => r.stockStatus === "LOW");
    const over = withStatus.filter((r) => r.stockStatus === "OVER");
    return {
      today,
      warningDays,
      counts: { low: low.length, over: over.length, expiring: expiring.length, expired: expired.length },
      low,
      over,
      expiring,
      expired,
    };
  }

  // --- internos -----------------------------------------------------------------

  /**
   * Corre la operación Serializable con reintento e idempotencia: la misma
   * `Idempotency-Key` devuelve el movimiento ya registrado (doble clic,
   * reintento tras un corte), también si dos peticiones iguales chocan.
   */
  private async register(requestId: string | undefined, actorId: string, fn: (tx: Tx) => Promise<string>) {
    if (requestId) {
      const previous = await this.byRequest(requestId, actorId);
      if (previous) return previous;
    }
    try {
      const id = await this.serializable(async (tx) => {
        const movementId = await fn(tx);
        if (requestId) await tx.kitchenMovement.update({ where: { id: movementId }, data: { requestId } });
        return movementId;
      });
      return this.movement(id);
    } catch (err) {
      if (requestId) {
        const previous = await this.byRequest(requestId, actorId);
        if (previous) return previous;
      }
      throw err;
    }
  }

  private async byRequest(requestId: string, actorId: string) {
    const previous = await this.db.kitchenMovement.findUnique({ where: { requestId }, include: movementInclude });
    if (!previous) return null;
    if (previous.createdById !== actorId) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");
    return serializeMovement(previous);
  }

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if (!isRetryableConflict(err)) throw err;
        if (attempt >= MAX_TX_ATTEMPTS) throw new HttpError(409, "CONCURRENT_UPDATE");
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
      }
    }
  }

  /**
   * Crea el movimiento y aplica cada línea al saldo de su lote con la regla
   * única. Una salida se aplica solo si el lote tiene con qué (`onHand >=`):
   * si no, 409 y la transacción completa se deshace.
   */
  private async createMovement(
    tx: Tx,
    type: KitchenMovementType,
    lines: LineToApply[],
    actorId: string,
    meta: { date?: string; reference?: string | null; notes?: string | null; purchaseOrderId?: string | null },
    wasteReason?: KitchenStockOutInput["wasteReason"] | null,
    reversalOfType?: KitchenMovementType,
    reversalOfId?: string
  ): Promise<string> {
    const sign = kitchenLedgerSign(type, reversalOfType);
    for (const line of lines) {
      const quantity = dec(line.quantity);
      if (sign === 1) {
        await tx.kitchenLot.update({ where: { id: line.lotId }, data: { onHand: { increment: quantity } } });
      } else {
        const { count } = await tx.kitchenLot.updateMany({ where: { id: line.lotId, onHand: { gte: quantity } }, data: { onHand: { decrement: quantity } } });
        if (count === 0) {
          const lot = await tx.kitchenLot.findUnique({ where: { id: line.lotId }, select: { lotCode: true, onHand: true } });
          throw new HttpError(409, "INSUFFICIENT_STOCK", { item: lot?.lotCode ?? line.lotId, missing: round3(line.quantity - (lot ? num(lot.onHand) : 0)) });
        }
      }
    }
    const movement = await tx.kitchenMovement.create({
      data: {
        type,
        date: meta.date ? new Date(meta.date) : new Date(),
        createdById: actorId,
        reference: meta.reference ?? null,
        notes: meta.notes ?? null,
        wasteReason: wasteReason ?? null,
        reversalOfId: reversalOfId ?? null,
        purchaseOrderId: meta.purchaseOrderId ?? null,
        lines: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            lotId: l.lotId,
            quantity: dec(l.quantity),
            unitCost: l.unitCost == null ? null : new Prisma.Decimal(l.unitCost),
          })),
        },
      },
    });
    await this.audit?.(
      {
        action: type === "REVERSAL" ? "KITCHEN_MOVEMENT_REVERSED" : "KITCHEN_MOVEMENT_CREATED",
        entityType: "KitchenMovement",
        entityId: movement.id,
        userId: actorId,
        metadata: { type, lines: lines.length, ...(reversalOfId && { reversalOfId }), ...(wasteReason && { wasteReason }) },
      },
      tx
    );
    return movement.id;
  }

  /** Artículos de las líneas; 404 si alguno no existe y 409 si está inactivo. */
  private async activeItems(tx: Tx | PrismaClient, ids: string[], { allowInactive = false } = {}) {
    const unique = [...new Set(ids)];
    const items = await tx.kitchenItem.findMany({ where: { id: { in: unique } }, include: { unit: unitSelect } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
      if (!allowInactive && !item.active) throw new HttpError(409, "KITCHEN_ITEM_INACTIVE", { item: item.name });
    }
    return byId;
  }

  private async lotOfItem(tx: Tx, lotId: string, itemId: string) {
    const lot = await tx.kitchenLot.findUnique({ where: { id: lotId } });
    if (!lot || lot.itemId !== itemId) throw new HttpError(404, "KITCHEN_LOT_NOT_FOUND");
    return lot;
  }

  private async fefoLots(tx: Tx | PrismaClient, itemId: string): Promise<FefoLot[]> {
    const lots = await tx.kitchenLot.findMany({ where: { itemId, onHand: { gt: 0 } } });
    return lots.map((l) => ({ id: l.id, lotCode: l.lotCode, expiresOn: dayOf(l.expiresAt), receivedAt: l.receivedAt, onHand: num(l.onHand) }));
  }

  /** Código de lote generado: `L-AAAAMMDD-###`, consecutivo por artículo y día. */
  private async nextLotCode(tx: Tx, itemId: string, receivedAt: Date): Promise<string> {
    const prefix = `L-${receivedAt.toISOString().slice(0, 10).replace(/-/g, "")}-`;
    const count = await tx.kitchenLot.count({ where: { itemId, lotCode: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(3, "0")}`;
  }
}
