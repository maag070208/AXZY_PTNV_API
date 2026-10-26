import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { HotelMovementService, MovementLineInput } from "./movement.service";
import {
  assertMovementShape,
  expectedStock,
  type HotelMovementType,
  type LedgerMovement,
} from "./kardex-rules";
import {
  OPEN_STOCKTAKE_STATUSES,
  assertAllCounted,
  assertCountedQuantity,
  countDifference,
  nextStocktakeStatus,
  splitAdjustments,
} from "./stocktake-rules";

export interface StocktakeLineCapture {
  productId: string;
  locationId: string;
  countedQty: number;
  notes?: string | null;
}

const COUNT_REASON_NAME = "Stocktake count";
const MAX_ATTEMPTS = 3;

/**
 * Physical counts (M4). There is no lock on the warehouse: the start takes a photo
 * of stock, and the difference at approval is counted − photo − movements posted
 * after the photo. Approval posts the adjustments in the same transaction.
 */
export class HotelStocktakeService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly audit?: AuditLogger
  ) {}

  async create(input: { warehouseId: string; notes?: string | null; blind?: boolean }, actorId: string) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, active: true } });
    if (!warehouse || !warehouse.active) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    const open = await this.db.hotelStocktake.findFirst({
      where: { warehouseId: input.warehouseId, status: { in: OPEN_STOCKTAKE_STATUSES } },
      select: { id: true },
    });
    if (open) throw new HttpError(409, "HOTEL_STOCKTAKE_OPEN_EXISTS");

    const count = await this.db.hotelStocktake.count();
    return this.db.hotelStocktake.create({
      data: {
        folio: `TI-H-${String(count + 1).padStart(4, "0")}`,
        warehouseId: input.warehouseId,
        notes: input.notes ?? null,
        blind: input.blind ?? true,
        createdById: actorId,
      },
    });
  }

  list(visibleWarehouseIds: string[] | null = null) {
    return this.db.hotelStocktake.findMany({
      where: visibleWarehouseIds ? { warehouseId: { in: visibleWarehouseIds } } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /** `showSystemQty` false hides the photo from blind counters while counting. */
  async get(id: string, showSystemQty: boolean) {
    const stocktake = await this.db.hotelStocktake.findUnique({
      where: { id },
      include: {
        lines: { include: { product: { select: { id: true, code: true, name: true } }, location: { select: { id: true, code: true } } } },
      },
    });
    if (!stocktake) throw new HttpError(404, "HOTEL_STOCKTAKE_NOT_FOUND");
    if (showSystemQty) return stocktake;
    return { ...stocktake, lines: stocktake.lines.map(({ systemQty: _hidden, ...line }) => line) };
  }

  /** Takes the photo of positive stock and opens the count. Serializable so the photo is consistent. */
  async start(id: string, actorId: string) {
    return this.serializable(async (tx) => {
      const stocktake = await this.find(tx, id);
      nextStocktakeStatus(stocktake.status, "start");
      const snapshotAt = new Date();
      const rows = await tx.hotelStock.findMany({
        where: { warehouseId: stocktake.warehouseId, quantity: { gt: 0 } },
        select: { productId: true, locationId: true, quantity: true },
      });
      if (rows.length > 0) {
        await tx.hotelStocktakeLine.createMany({
          data: rows.map((row) => ({
            stocktakeId: id,
            productId: row.productId,
            locationId: row.locationId,
            systemQty: row.quantity,
          })),
        });
      }
      const updated = await tx.hotelStocktake.update({
        where: { id },
        data: { status: "COUNTING", snapshotAt, openedAt: snapshotAt },
      });
      await this.log("HOTEL_STOCKTAKE_STARTED", id, actorId, { status: stocktake.status }, { status: "COUNTING" });
      return updated;
    });
  }

  /** Records counts. A product or location not in the photo starts at zero (it was not stocked then). */
  async capture(id: string, lines: StocktakeLineCapture[], actorId: string) {
    return this.serializable(async (tx) => {
      const stocktake = await this.find(tx, id);
      if (stocktake.status !== "COUNTING") throw new HttpError(409, "HOTEL_STOCKTAKE_INVALID_STATE");

      for (const line of lines) {
        assertCountedQuantity(line.countedQty);
        const location = await tx.hotelLocation.findFirst({
          where: { id: line.locationId, warehouseId: stocktake.warehouseId, active: true },
          select: { id: true },
        });
        if (!location) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE");

        const existing = await tx.hotelStocktakeLine.findUnique({
          where: { stocktakeId_productId_locationId: { stocktakeId: id, productId: line.productId, locationId: line.locationId } },
        });
        const counted = { countedQty: line.countedQty, countedById: actorId, countedAt: new Date(), notes: line.notes ?? null };
        if (existing) {
          await tx.hotelStocktakeLine.update({ where: { id: existing.id }, data: counted });
        } else {
          await tx.hotelStocktakeLine.create({
            data: { stocktakeId: id, productId: line.productId, locationId: line.locationId, systemQty: 0, ...counted },
          });
        }
      }
      return tx.hotelStocktake.findUnique({ where: { id }, include: { lines: true } });
    });
  }

  /** Closing requires every line to be counted. */
  async close(id: string, actorId: string) {
    return this.serializable(async (tx) => {
      const stocktake = await this.find(tx, id);
      const next = nextStocktakeStatus(stocktake.status, "close");
      const lines = await tx.hotelStocktakeLine.findMany({ where: { stocktakeId: id }, select: { countedQty: true } });
      assertAllCounted(lines.map((l) => ({ countedQty: l.countedQty === null ? null : Number(l.countedQty) })));
      const updated = await tx.hotelStocktake.update({
        where: { id },
        data: { status: next, closedById: actorId, closedAt: new Date() },
      });
      await this.log("HOTEL_STOCKTAKE_CLOSED", id, actorId, { status: stocktake.status }, { status: next });
      return updated;
    });
  }

  /**
   * Approves the count and posts its adjustments (inbound and outbound) in the same
   * transaction. `canApproveOwnClose` is true only for the ALL scope, which is then
   * recorded as approved by the same person (plan 4.2).
   */
  async approve(id: string, actorId: string, canApproveOwnClose: boolean) {
    return this.serializable(async (tx) => {
      const stocktake = await this.find(tx, id);
      const next = nextStocktakeStatus(stocktake.status, "approve");
      if (stocktake.closedById === actorId && !canApproveOwnClose) {
        throw new HttpError(403, "HOTEL_SELF_APPROVAL");
      }
      if (!stocktake.snapshotAt) throw new HttpError(409, "HOTEL_STOCKTAKE_INVALID_STATE");

      const lines = await tx.hotelStocktakeLine.findMany({ where: { stocktakeId: id } });
      const since = await this.movementsSince(tx, stocktake.warehouseId, stocktake.snapshotAt);

      const diffs = lines.map((line) => {
        const movementsSince = since.get(`${line.productId}|${line.locationId}`) ?? 0;
        const difference = countDifference(Number(line.countedQty ?? 0), Number(line.systemQty ?? 0), movementsSince);
        return { line, difference };
      }).filter((d) => Math.abs(d.difference) > 1e-9);
      const split = splitAdjustments(diffs.map((d) => ({ ...d, difference: d.difference })));

      if (split.inbound.length + split.outbound.length > 0) {
        const reason = await tx.hotelReason.findFirst({
          where: { kind: "ADJUSTMENT", name: COUNT_REASON_NAME, active: true },
          select: { id: true },
        });
        if (!reason) throw new HttpError(422, "HOTEL_STOCKTAKE_REASON_MISSING");

        const post = async (type: HotelMovementType, rows: Array<{ line: { productId: string; locationId: string }; difference: number }>) => {
          if (rows.length === 0) return;
          const input = {
            type,
            warehouseId: type === "ADJUST_IN" ? stocktake.warehouseId : null,
            fromWarehouseId: type === "ADJUST_OUT" ? stocktake.warehouseId : null,
            reasonId: reason.id,
            stocktakeId: id,
            skipApproval: true,
            notes: `${stocktake.folio}`,
            lines: rows.map<MovementLineInput>((r) => ({
              productId: r.line.productId,
              quantity: Math.abs(r.difference),
              toLocationId: type === "ADJUST_IN" ? r.line.locationId : null,
              fromLocationId: type === "ADJUST_OUT" ? r.line.locationId : null,
            })),
          };
          assertMovementShape(type, input);
          await this.movements.applyInTransaction(tx, input, actorId, null);
        };
        await post("ADJUST_IN", split.inbound);
        await post("ADJUST_OUT", split.outbound);
      }

      const updated = await tx.hotelStocktake.update({
        where: { id },
        data: { status: next, approvedById: actorId, approvedAt: new Date() },
      });
      await this.log("HOTEL_STOCKTAKE_APPROVED", id, actorId, { status: stocktake.status }, { status: next, adjustments: diffs.length });
      return updated;
    });
  }

  async cancel(id: string, actorId: string) {
    return this.db.$transaction(async (tx) => {
      const stocktake = await this.find(tx, id);
      const next = nextStocktakeStatus(stocktake.status, "cancel");
      const updated = await tx.hotelStocktake.update({
        where: { id },
        data: { status: next, cancelledAt: new Date() },
      });
      await this.log("HOTEL_STOCKTAKE_CANCELLED", id, actorId, { status: stocktake.status }, { status: next });
      return updated;
    });
  }

  /** Net movement per product and location posted after the photo, for one warehouse. */
  private async movementsSince(tx: Prisma.TransactionClient, warehouseId: string, snapshotAt: Date): Promise<Map<string, number>> {
    const movements = await tx.hotelMovement.findMany({
      where: {
        status: "ACTIVE",
        createdAt: { gt: snapshotAt },
        OR: [{ warehouseId }, { fromWarehouseId: warehouseId }],
      },
      include: { lines: true },
    });
    const ledger: LedgerMovement[] = movements.map((m) => ({
      type: m.type as HotelMovementType,
      fromWarehouseId: m.fromWarehouseId,
      warehouseId: m.warehouseId,
      lines: m.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        fromLocationId: l.fromLocationId,
        toLocationId: l.toLocationId,
      })),
    }));
    const net = new Map<string, number>();
    for (const [, position] of expectedStock(ledger)) {
      if (position.warehouseId !== warehouseId) continue;
      net.set(`${position.productId}|${position.locationId}`, position.quantity);
    }
    return net;
  }

  private async find(tx: Prisma.TransactionClient, id: string) {
    const stocktake = await tx.hotelStocktake.findUnique({ where: { id } });
    if (!stocktake) throw new HttpError(404, "HOTEL_STOCKTAKE_NOT_FOUND");
    return stocktake;
  }

  private serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const run = async (attempt: number): Promise<T> => {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if ((err as { code?: string })?.code === "P2034" && attempt < MAX_ATTEMPTS) return run(attempt + 1);
        throw err;
      }
    };
    return run(1);
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({
      action,
      entityType: "HotelStocktake",
      entityId: id,
      userId: actorId,
      previousState,
      newState,
    });
  }
}
