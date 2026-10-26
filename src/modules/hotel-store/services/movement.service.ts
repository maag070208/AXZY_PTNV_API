import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { assertWholeQuantity } from "./hotel-catalog-rules";
import {
  assertDifferentLocations,
  assertMovementShape,
  assertSufficientStock,
  invertDeltas,
  isCancellable,
  ledgerDeltas,
  type HotelMovementType,
} from "./kardex-rules";

export interface MovementLineInput {
  productId: string;
  quantity: number;
  unitCost?: number | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}

export interface MovementInput {
  type: HotelMovementType;
  fromWarehouseId?: string | null;
  warehouseId?: string | null;
  roomId?: string | null;
  reasonId?: string | null;
  notes?: string | null;
  lines: MovementLineInput[];
}

/** Types the API accepts today. Consumption and linen come from tasks (M5/M6); adjustments need the approval flow (M3 4.4). */
const API_TYPES: HotelMovementType[] = ["INITIAL_LOAD", "INBOUND", "TRANSFER", "WRITE_OFF"];

const MAX_ATTEMPTS = 3;

/**
 * The warehouse ledger (M3 3.2). Every stock change is a movement, applied in a
 * SERIALIZABLE transaction: stock is never negative, and a repeated request key
 * returns the original movement without writing again.
 */
export class HotelMovementService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async post(input: MovementInput, actorId: string, requestId?: string | null) {
    if (!API_TYPES.includes(input.type)) throw new HttpError(422, "HOTEL_MOVEMENT_TYPE_NOT_SUPPORTED");
    if (requestId) {
      const existing = await this.db.hotelMovement.findUnique({ where: { requestId }, include: { lines: true } });
      if (existing) return existing;
    }
    assertMovementShape(input.type, input);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction((tx) => this.apply(tx, input, actorId, requestId ?? null), {
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

  private async apply(tx: Prisma.TransactionClient, input: MovementInput, actorId: string, requestId: string | null) {
    const deltas = ledgerDeltas(input.type);
    const lines: Array<{
      productId: string;
      quantity: number;
      unitCost: number | null;
      fromLocationId: string | null;
      toLocationId: string | null;
      sourceWarehouseId: string | null;
      targetWarehouseId: string | null;
    }> = [];

    for (const line of input.lines) {
      const product = await tx.hotelProduct.findUnique({
        where: { id: line.productId },
        include: { unit: { select: { whole: true } } },
      });
      if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
      if (!product.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
      assertWholeQuantity(line.quantity, product.unit.whole);

      const fromLocationId =
        deltas.source !== 0 ? await this.locationOf(tx, input.fromWarehouseId!, line.fromLocationId) : null;
      const toLocationId =
        deltas.target !== 0 ? await this.locationOf(tx, input.warehouseId!, line.toLocationId) : null;
      if (input.type === "TRANSFER" && input.fromWarehouseId === input.warehouseId) {
        assertDifferentLocations(fromLocationId!, toLocationId!);
      }

      // Inbound and initial loads take the cost given; other movements freeze the last known cost.
      const needsCost = input.type === "INBOUND" || input.type === "INITIAL_LOAD";
      if (needsCost && (line.unitCost === undefined || line.unitCost === null)) {
        throw new HttpError(422, "HOTEL_UNIT_COST_REQUIRED");
      }
      const unitCost = needsCost ? line.unitCost! : product.lastCost ? Number(product.lastCost) : null;

      lines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitCost,
        fromLocationId,
        toLocationId,
        sourceWarehouseId: deltas.source !== 0 ? input.fromWarehouseId! : null,
        targetWarehouseId: deltas.target !== 0 ? input.warehouseId! : null,
      });
    }

    for (const line of lines) {
      if (line.fromLocationId) await this.move(tx, line.productId, line.sourceWarehouseId!, line.fromLocationId, -line.quantity);
      if (line.toLocationId) await this.move(tx, line.productId, line.targetWarehouseId!, line.toLocationId, line.quantity);
    }

    return tx.hotelMovement.create({
      data: {
        folio: await this.nextFolio(tx),
        type: input.type,
        status: "ACTIVE",
        fromWarehouseId: input.fromWarehouseId ?? null,
        warehouseId: input.warehouseId ?? null,
        roomId: input.roomId ?? null,
        reasonId: input.reasonId ?? null,
        notes: input.notes ?? null,
        createdById: actorId,
        requestId,
        lines: { create: lines.map(({ sourceWarehouseId: _s, targetWarehouseId: _t, ...row }) => ({
          productId: row.productId,
          quantity: row.quantity,
          unitCost: row.unitCost,
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
        })) },
      },
      include: { lines: true },
    });
  }

  /** Cancels an active movement by applying the opposite signs. Stock must cover the reversal. */
  async cancel(id: string, actorId: string) {
    return this.db.$transaction(
      async (tx) => {
        const movement = await tx.hotelMovement.findUnique({ where: { id }, include: { lines: true } });
        if (!movement) throw new HttpError(404, "HOTEL_MOVEMENT_NOT_FOUND");
        if (movement.status !== "ACTIVE") throw new HttpError(409, "HOTEL_MOVEMENT_NOT_ACTIVE");
        if (!isCancellable(movement.type as HotelMovementType)) {
          throw new HttpError(409, "HOTEL_MOVEMENT_NOT_CANCELLABLE");
        }

        const inverse = invertDeltas(ledgerDeltas(movement.type as HotelMovementType));
        for (const line of movement.lines) {
          const qty = Number(line.quantity);
          if (inverse.source !== 0 && line.fromLocationId) {
            await this.move(tx, line.productId, movement.fromWarehouseId!, line.fromLocationId, qty);
          }
          if (inverse.target !== 0 && line.toLocationId) {
            await this.move(tx, line.productId, movement.warehouseId!, line.toLocationId, -qty);
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

  list(filters: { type?: HotelMovementType; roomId?: string; visibleWarehouseIds?: string[] | null } = {}) {
    const visible = filters.visibleWarehouseIds;
    return this.db.hotelMovement.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
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

  /** Adds `delta` (negative to take out) to a stock row. Takes out only if the stock covers it. */
  private async move(tx: Prisma.TransactionClient, productId: string, warehouseId: string, locationId: string, delta: number) {
    const row = await tx.hotelStock.findUnique({
      where: { productId_warehouseId_locationId: { productId, warehouseId, locationId } },
    });
    const available = row ? Number(row.quantity) : 0;
    if (delta < 0) {
      assertSufficientStock(productId, available, -delta);
    }
    if (row) {
      await tx.hotelStock.update({ where: { id: row.id }, data: { quantity: available + delta } });
    } else {
      await tx.hotelStock.create({ data: { productId, warehouseId, locationId, quantity: delta } });
    }
  }

  /** Sequential folio: MOV-H-0001, MOV-H-0002… (the unique index protects against collisions). */
  private async nextFolio(tx: Prisma.TransactionClient): Promise<string> {
    const count = await tx.hotelMovement.count();
    return `MOV-H-${String(count + 1).padStart(4, "0")}`;
  }
}
