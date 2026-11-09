import { Prisma, type HotelMovementStatus, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { assertWholeQuantity } from "./hotel-catalog-rules";
import {
  DEFAULT_ADJUST_THRESHOLDS,
  assertDifferentLocations,
  assertMovementShape,
  assertSpaIsolation,
  assertSufficientStock,
  invertDeltas,
  isCancellable,
  ledgerDeltas,
  needsApproval,
  type ApprovalThresholds,
  type HotelMovementType,
} from "./kardex-rules";
import { assertNotRequester, writeoffForcesPending } from "../linen/services/writeoff-rules";
import { allocateFifo, assertLotCovers, lotCode, lotDatePrefix } from "./lot-rules";

export interface MovementLineInput {
  productId: string;
  quantity: number;
  unitCost?: number | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  /**
   * Lote. Salidas y traspasos: lote del que sale (sin él, reparto FIFO que puede partir la línea).
   * Entradas: lote existente al que suma (sin él, se crea un lote nuevo).
   */
  lotId?: string | null;
}

export interface MovementInput {
  type: HotelMovementType;
  fromWarehouseId?: string | null;
  warehouseId?: string | null;
  roomId?: string | null;
  reasonId?: string | null;
  notes?: string | null;
  lines: MovementLineInput[];
  /** Counts that generate adjustments: the approval of the count is the approval (M4 4.2). */
  stocktakeId?: string | null;
  skipApproval?: boolean;
  /** Fuerza PENDING_APPROVAL sin mover stock (bajas de blancos, D9). */
  forcePending?: boolean;
  /** Traspaso que solo saca del origen: queda IN_TRANSIT hasta que el destino lo recibe (D6). */
  inTransit?: boolean;
  /** Documento de origen (p. ej. HOTEL_TRANSFER). */
  sourceDocType?: string | null;
  sourceDocId?: string | null;
}

/** Types the API accepts. Consumption and linen come from tasks (M5/M6). */
const API_TYPES: HotelMovementType[] = ["INITIAL_LOAD", "INBOUND", "TRANSFER", "WRITE_OFF", "ADJUST_IN", "ADJUST_OUT"];

/** Tipos que se comportan como traspaso entre almacenes (ledger de origen -> destino). */
const TRANSFER_LIKE: HotelMovementType[] = ["TRANSFER", "FIRST_WASH", "SUPPLIER_RETURN", "LOAN_OUT", "LOAN_RETURN"];
const isTransferLike = (type: HotelMovementType) => TRANSFER_LIKE.includes(type);
/** Los que pueden quedar IN_TRANSIT hasta que el destino recibe. */
const IN_TRANSIT_TYPES: HotelMovementType[] = TRANSFER_LIKE;

const MAX_ATTEMPTS = 3;

/**
 * The warehouse ledger (M3 3.2). Every stock change is a movement, applied in a
 * SERIALIZABLE transaction: stock is never negative, and a repeated request key
 * returns the original movement without writing again.
 */
export class HotelMovementService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly thresholds: ApprovalThresholds = DEFAULT_ADJUST_THRESHOLDS
  ) {}

  async post(input: MovementInput, actorId: string, requestId?: string | null) {
    if (!API_TYPES.includes(input.type)) throw new HttpError(422, "HOTEL_MOVEMENT_TYPE_NOT_SUPPORTED");
    if (requestId) {
      const existing = await this.db.hotelMovement.findUnique({ where: { requestId }, include: { lines: true } });
      if (existing) return existing;
    }
    assertMovementShape(input.type, input);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction((tx) => this.applyInTransaction(tx, input, actorId, requestId ?? null), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        const retryable = (err as { code?: string })?.code === "P2034";
        if (retryable && attempt < MAX_ATTEMPTS) continue;
        if ((err as { code?: string })?.code === "P2002") throw new HttpError(409, "HOTEL_MOVEMENT_DUPLICATE");
        throw err;
      }
    }
  }

  /**
   * Applies a movement inside a caller's transaction (used by stocktakes to post their
   * adjustments atomically). The caller validates the shape with `assertMovementShape`.
   */
  async applyInTransaction(tx: Prisma.TransactionClient, input: MovementInput, actorId: string, requestId: string | null) {
    const deltas = ledgerDeltas(input.type);
    const lines: Array<{
      productId: string;
      quantity: number;
      unitCost: number | null;
      lotId: string;
      fromLocationId: string | null;
      toLocationId: string | null;
      sourceWarehouseId: string | null;
      targetWarehouseId: string | null;
    }> = [];
    // Saldo ya comprometido por líneas anteriores de este movimiento (aún no se aplica al stock).
    const reserved = new Map<string, number>();
    const newLotIds: string[] = [];
    const productKinds: string[] = [];
    if (input.inTransit && !IN_TRANSIT_TYPES.includes(input.type)) throw new HttpError(422, "HOTEL_MOVEMENT_TYPE_NOT_SUPPORTED");

    if (isTransferLike(input.type) && input.fromWarehouseId && input.warehouseId) {
      const kinds = await tx.hotelWarehouse.findMany({
        where: { id: { in: [input.fromWarehouseId, input.warehouseId] } },
        select: { id: true, kind: true },
      });
      const kindOf = (id: string) => kinds.find((w) => w.id === id)?.kind;
      assertSpaIsolation(input.type, kindOf(input.fromWarehouseId), kindOf(input.warehouseId));
    }

    for (const line of input.lines) {
      const product = await tx.hotelProduct.findUnique({
        where: { id: line.productId },
        include: { unit: { select: { whole: true } } },
      });
      if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
      if (!product.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
      assertWholeQuantity(line.quantity, product.unit.whole);
      productKinds.push(product.kind);

      const fromLocationId =
        deltas.source !== 0 ? await this.locationOf(tx, input.fromWarehouseId!, line.fromLocationId) : null;
      const toLocationId =
        deltas.target !== 0 ? await this.locationOf(tx, input.warehouseId!, line.toLocationId) : null;
      if (isTransferLike(input.type) && input.fromWarehouseId === input.warehouseId) {
        assertDifferentLocations(fromLocationId!, toLocationId!);
      }

      // Inbound takes the cost it was received at (required); other movements, including
      // initial loads, use the cost given when there is one, else the last known cost.
      if (input.type === "INBOUND" && (line.unitCost === undefined || line.unitCost === null)) {
        throw new HttpError(422, "HOTEL_UNIT_COST_REQUIRED");
      }
      const unitCost =
        line.unitCost !== undefined && line.unitCost !== null
          ? line.unitCost
          : product.lastCost
            ? Number(product.lastCost)
            : null;

      // Lotes: la salida los toma (explícito o FIFO) y el destino de un traspaso conserva el lote;
      // una entrada pura crea un lote nuevo (o suma a uno indicado).
      let allocations: Array<{ lotId: string; quantity: number }>;
      if (deltas.source !== 0) {
        allocations = await this.allocate(tx, line.productId, input.fromWarehouseId!, fromLocationId!, line.quantity, line.lotId ?? null, reserved);
      } else if (line.lotId) {
        await this.assertLotOfProduct(tx, line.lotId, line.productId);
        allocations = [{ lotId: line.lotId, quantity: line.quantity }];
      } else {
        const lot = await this.createLot(tx, line.productId, line.quantity);
        newLotIds.push(lot.id);
        allocations = [{ lotId: lot.id, quantity: line.quantity }];
      }

      for (const allocation of allocations) {
        lines.push({
          productId: line.productId,
          quantity: allocation.quantity,
          unitCost,
          lotId: allocation.lotId,
          fromLocationId,
          toLocationId,
          sourceWarehouseId: deltas.source !== 0 ? input.fromWarehouseId! : null,
          targetWarehouseId: deltas.target !== 0 ? input.warehouseId! : null,
        });
      }
    }

    // Adjustments above the threshold are recorded but do not move stock until approved.
    const isAdjustment = input.type === "ADJUST_IN" || input.type === "ADJUST_OUT";
    const totals = {
      quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      cost: lines.reduce((sum, line) => sum + line.quantity * (line.unitCost ?? 0), 0),
    };
    const status = input.inTransit
      ? "IN_TRANSIT"
      : input.forcePending || writeoffForcesPending(input.type, productKinds)
        ? "PENDING_APPROVAL"
        : isAdjustment && !input.skipApproval && needsApproval(totals, this.thresholds)
        ? "PENDING_APPROVAL"
        : "ACTIVE";

    if (status === "ACTIVE" || status === "IN_TRANSIT") {
      for (const line of lines) {
        if (line.fromLocationId) await this.move(tx, line.productId, line.sourceWarehouseId!, line.fromLocationId, line.lotId, -line.quantity);
        // En tránsito el destino todavía no recibe: entra al recibir lo contado.
        if (line.toLocationId && status === "ACTIVE") {
          await this.move(tx, line.productId, line.targetWarehouseId!, line.toLocationId, line.lotId, line.quantity);
        }
      }
    }

    const created = await tx.hotelMovement.create({
      data: {
        folio: await this.nextFolio(tx),
        type: input.type,
        status,
        fromWarehouseId: input.fromWarehouseId ?? null,
        warehouseId: input.warehouseId ?? null,
        roomId: input.roomId ?? null,
        reasonId: input.reasonId ?? null,
        notes: input.notes ?? null,
        createdById: actorId,
        requestId,
        stocktakeId: input.stocktakeId ?? null,
        sourceDocType: input.sourceDocType ?? null,
        sourceDocId: input.sourceDocId ?? null,
        lines: { create: lines.map(({ sourceWarehouseId: _s, targetWarehouseId: _t, ...row }) => ({
          productId: row.productId,
          quantity: row.quantity,
          unitCost: row.unitCost,
          lotId: row.lotId,
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
        })) },
      },
      include: { lines: true },
    });
    if (newLotIds.length > 0) {
      await tx.hotelLot.updateMany({ where: { id: { in: newLotIds } }, data: { sourceMovementId: created.id } });
    }
    return created;
  }

  /** Cancels an active movement by applying the opposite signs. Stock must cover the reversal. */
  async cancel(id: string, actorId: string) {
    return this.db.$transaction(
      async (tx) => {
        const movement = await tx.hotelMovement.findUnique({ where: { id }, include: { lines: true } });
        if (!movement) throw new HttpError(404, "HOTEL_MOVEMENT_NOT_FOUND");
        if (movement.status !== "ACTIVE") throw new HttpError(409, "HOTEL_MOVEMENT_NOT_ACTIVE");
        if (!isCancellable(movement.type as HotelMovementType) || movement.receivedAt) {
          throw new HttpError(409, "HOTEL_MOVEMENT_NOT_CANCELLABLE");
        }

        const inverse = invertDeltas(ledgerDeltas(movement.type as HotelMovementType));
        for (const line of movement.lines) {
          const qty = Number(line.quantity);
          if (inverse.source !== 0 && line.fromLocationId) {
            await this.move(tx, line.productId, movement.fromWarehouseId!, line.fromLocationId, line.lotId, qty);
          }
          if (inverse.target !== 0 && line.toLocationId) {
            await this.move(tx, line.productId, movement.warehouseId!, line.toLocationId, line.lotId, -qty);
          }
        }
        return tx.hotelMovement.update({
          where: { id },
          data: { status: "CANCELLED", approvedById: actorId, approvedAt: new Date() },
          include: { lines: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /** Applies a pending adjustment: same stock rules as a direct movement (stock must cover it). */
  async approve(id: string, actorId: string) {
    return this.db.$transaction(
      async (tx) => {
        const movement = await this.findPending(tx, id);
        // D9: en bajas de blancos quien aprueba no puede ser quien las creó.
        if (movement.type === "WRITE_OFF") {
          const products = await tx.hotelProduct.findMany({ where: { id: { in: movement.lines.map((l) => l.productId) } }, select: { kind: true } });
          if (writeoffForcesPending(movement.type, products.map((p) => p.kind))) assertNotRequester(movement.createdById, actorId);
        }
        const deltas = ledgerDeltas(movement.type as HotelMovementType);
        for (const line of movement.lines) {
          const qty = Number(line.quantity);
          if (deltas.source !== 0 && line.fromLocationId) {
            await this.move(tx, line.productId, movement.fromWarehouseId!, line.fromLocationId, line.lotId, -qty);
          }
          if (deltas.target !== 0 && line.toLocationId) {
            await this.move(tx, line.productId, movement.warehouseId!, line.toLocationId, line.lotId, qty);
          }
        }
        return tx.hotelMovement.update({
          where: { id },
          data: { status: "ACTIVE", approvedById: actorId, approvedAt: new Date() },
          include: { lines: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /** Rejects a pending adjustment: it is cancelled and stock does not move. */
  async reject(id: string, actorId: string) {
    return this.db.$transaction(async (tx) => {
      await this.findPending(tx, id);
      return tx.hotelMovement.update({
        where: { id },
        data: { status: "CANCELLED", approvedById: actorId, approvedAt: new Date() },
        include: { lines: true },
      });
    });
  }

  private async findPending(tx: Prisma.TransactionClient, id: string) {
    const movement = await tx.hotelMovement.findUnique({ where: { id }, include: { lines: true } });
    if (!movement) throw new HttpError(404, "HOTEL_MOVEMENT_NOT_FOUND");
    if (movement.status !== "PENDING_APPROVAL") throw new HttpError(409, "HOTEL_MOVEMENT_NOT_PENDING");
    return movement;
  }

  list(filters: { type?: HotelMovementType; roomId?: string; status?: HotelMovementStatus; visibleWarehouseIds?: string[] | null } = {}) {
    const visible = filters.visibleWarehouseIds;
    return this.db.hotelMovement.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.roomId ? { roomId: filters.roomId } : {}),
        ...(visible ? { OR: [{ warehouseId: { in: visible } }, { fromWarehouseId: { in: visible } }] } : {}),
      },
      include: { lines: true },
      orderBy: { date: "desc" },
      take: 200,
    });
  }

  async get(id: string) {
    const movement = await this.db.hotelMovement.findUnique({ where: { id }, include: { lines: true } });
    if (!movement) throw new HttpError(404, "HOTEL_MOVEMENT_NOT_FOUND");
    return movement;
  }

  /** The location given, or the warehouse default. It must belong to the warehouse and be active. */
  private async locationOf(tx: Prisma.TransactionClient, warehouseId: string, locationId?: string | null): Promise<string> {
    if (locationId) {
      const location = await tx.hotelLocation.findFirst({ where: { id: locationId, warehouseId, active: true }, select: { id: true } });
      if (!location) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE");
      return location.id;
    }
    const location = await tx.hotelLocation.findFirst({
      where: { warehouseId, isDefault: true, active: true },
      select: { id: true },
    });
    if (!location) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE");
    return location.id;
  }

  /** Adds `delta` (negative to take out) to the stock row of a lot. Takes out only if the lot's stock covers it. */
  async move(tx: Prisma.TransactionClient, productId: string, warehouseId: string, locationId: string, lotId: string, delta: number) {
    const row = await tx.hotelStock.findUnique({
      where: { productId_warehouseId_locationId_lotId: { productId, warehouseId, locationId, lotId } },
    });
    const available = row ? Number(row.quantity) : 0;
    if (delta < 0) {
      assertSufficientStock(productId, available, -delta);
    }
    if (row) {
      await tx.hotelStock.update({ where: { id: row.id }, data: { quantity: available + delta } });
    } else {
      await tx.hotelStock.create({ data: { productId, warehouseId, locationId, lotId, quantity: delta } });
    }
  }

  /**
   * Lotes de los que sale `quantity`: el indicado (debe cubrirlo) o FIFO por fecha de entrada.
   * `reserved` descuenta lo ya tomado por otras líneas del mismo movimiento.
   */
  private async allocate(
    tx: Prisma.TransactionClient,
    productId: string,
    warehouseId: string,
    locationId: string,
    quantity: number,
    lotId: string | null,
    reserved: Map<string, number>
  ): Promise<Array<{ lotId: string; quantity: number }>> {
    const keyOf = (lot: string) => `${warehouseId}|${locationId}|${lot}`;
    const rows = await tx.hotelStock.findMany({
      where: { productId, warehouseId, locationId, ...(lotId ? { lotId } : {}), quantity: { gt: 0 } },
      include: { lot: { select: { receivedAt: true, code: true } } },
    });
    const candidates = rows.map((row) => ({
      lotId: row.lotId,
      receivedAt: row.lot.receivedAt,
      code: row.lot.code,
      available: Number(row.quantity) - (reserved.get(keyOf(row.lotId)) ?? 0),
    }));
    let allocations: Array<{ lotId: string; quantity: number }>;
    if (lotId) {
      await this.assertLotOfProduct(tx, lotId, productId);
      assertLotCovers(productId, lotId, candidates[0]?.available ?? 0, quantity);
      allocations = [{ lotId, quantity }];
    } else {
      const result = allocateFifo(candidates, quantity);
      if (result.remaining > 0) {
        const total = candidates.reduce((sum, c) => sum + Math.max(c.available, 0), 0);
        assertSufficientStock(productId, total, quantity);
      }
      allocations = result.allocations;
    }
    for (const a of allocations) reserved.set(keyOf(a.lotId), (reserved.get(keyOf(a.lotId)) ?? 0) + a.quantity);
    return allocations;
  }

  private async assertLotOfProduct(tx: Prisma.TransactionClient, lotId: string, productId: string) {
    const lot = await tx.hotelLot.findUnique({ where: { id: lotId }, select: { productId: true } });
    if (!lot || lot.productId !== productId) throw new HttpError(422, "HOTEL_LOT_NOT_FOUND");
  }

  /** Lote nuevo `AAAAMMDD-n` del producto (n = consecutivo de ese día). El unique protege colisiones. */
  private async createLot(tx: Prisma.TransactionClient, productId: string, quantity: number) {
    const receivedAt = new Date();
    const sameDay = await tx.hotelLot.count({ where: { productId, code: { startsWith: `${lotDatePrefix(receivedAt)}-` } } });
    return tx.hotelLot.create({
      data: { productId, code: lotCode(receivedAt, sameDay + 1), receivedAt, initialQuantity: quantity },
    });
  }

  /** Sequential folio: MOV-H-0001, MOV-H-0002… (the unique index protects against collisions). */
  private async nextFolio(tx: Prisma.TransactionClient): Promise<string> {
    const count = await tx.hotelMovement.count();
    return `MOV-H-${String(count + 1).padStart(4, "0")}`;
  }
}
