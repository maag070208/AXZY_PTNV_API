import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { diffStock, expectedStock, type LedgerMovement, type HotelMovementType } from "./kardex-rules";

/** Read side of the ledger: materialized stock and its reconciliation against the movements (M3 3.5). */
export class HotelStockService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  rows() {
    return this.db.hotelStock.findMany({
      include: {
        product: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        location: { select: { id: true, code: true } },
      },
      orderBy: [{ warehouseId: "asc" }, { productId: "asc" }],
    });
  }

  /** Materialized stock vs the signed sum of active movement lines. Differences are reported, never fixed here. */
  async reconcile() {
    const [rows, movements] = await Promise.all([
      this.db.hotelStock.findMany({ select: { productId: true, warehouseId: true, locationId: true, quantity: true } }),
      this.db.hotelMovement.findMany({
        where: { status: "ACTIVE" },
        include: { lines: true },
      }),
    ]);
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
    const actual = rows.map((r) => ({
      productId: r.productId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      quantity: Number(r.quantity),
    }));
    return diffStock(actual, expectedStock(ledger));
  }
}
