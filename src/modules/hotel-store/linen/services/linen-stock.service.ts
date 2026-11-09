import type { HotelProductKind, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { stockLight } from "./transfer-rules";

const PRODUCT_KINDS: HotelProductKind[] = ["CONSUMABLE", "LINEN", "EQUIPMENT"];

/** Lectura de existencias de blancos: resumen con tránsito y semáforo, lotes y límites por almacén. */
export class HotelLinenStockService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  /**
   * Por producto: existencia por almacén (y por tipo de almacén), en tránsito, total, par y semáforo.
   * `visibleIds` null = todos los almacenes. Lo en tránsito cuenta en el total.
   */
  async summary(visibleIds: string[] | null, kind?: string) {
    if (kind && !PRODUCT_KINDS.includes(kind as HotelProductKind)) throw new HttpError(400, "INVALID_FILTER", { field: "kind" });
    const warehouseFilter = visibleIds ? { in: visibleIds } : undefined;
    const [products, stock, transit] = await Promise.all([
      this.db.hotelProduct.findMany({
        where: { active: true, ...(kind ? { kind: kind as HotelProductKind } : {}) },
        select: { id: true, code: true, name: true, size: true, kind: true, idealStock: true },
        orderBy: { code: "asc" },
      }),
      this.db.hotelStock.findMany({
        where: { quantity: { gt: 0 }, ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}) },
        select: { productId: true, quantity: true, warehouse: { select: { id: true, code: true, name: true, kind: true } } },
      }),
      this.db.hotelMovementLine.findMany({
        where: {
          movement: {
            status: "IN_TRANSIT",
            ...(visibleIds ? { OR: [{ fromWarehouseId: { in: visibleIds } }, { warehouseId: { in: visibleIds } }] } : {}),
          },
        },
        select: { productId: true, quantity: true },
      }),
    ]);

    const stockBy = new Map<string, Map<string, { warehouseId: string; code: string; name: string; kind: string; quantity: number }>>();
    for (const row of stock) {
      const perWarehouse = stockBy.get(row.productId) ?? new Map();
      const current = perWarehouse.get(row.warehouse.id) ?? { warehouseId: row.warehouse.id, code: row.warehouse.code, name: row.warehouse.name, kind: row.warehouse.kind, quantity: 0 };
      current.quantity += Number(row.quantity);
      perWarehouse.set(row.warehouse.id, current);
      stockBy.set(row.productId, perWarehouse);
    }
    const transitBy = new Map<string, number>();
    for (const line of transit) transitBy.set(line.productId, (transitBy.get(line.productId) ?? 0) + Number(line.quantity));

    return products.map((p) => {
      const byWarehouse = [...(stockBy.get(p.id)?.values() ?? [])].sort((a, b) => a.code.localeCompare(b.code));
      const byKind: Record<string, number> = {};
      for (const w of byWarehouse) byKind[w.kind] = (byKind[w.kind] ?? 0) + w.quantity;
      const inTransit = transitBy.get(p.id) ?? 0;
      const total = byWarehouse.reduce((s, w) => s + w.quantity, 0) + inTransit;
      const par = Number(p.idealStock);
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        size: p.size,
        kind: p.kind,
        byWarehouse,
        byKind,
        inTransit,
        total,
        par,
        pct: par > 0 ? total / par : null,
        light: stockLight(total, par),
      };
    });
  }

  /** Lotes de un producto (o todos) con su saldo por almacén; solo almacenes visibles. */
  async lots(productId: string | undefined, visibleIds: string[] | null) {
    const lots = await this.db.hotelLot.findMany({
      where: { ...(productId ? { productId } : {}) },
      include: {
        product: { select: { id: true, code: true, name: true } },
        stock: {
          where: { quantity: { gt: 0 }, ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}) },
          select: { quantity: true, warehouse: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: [{ receivedAt: "asc" }, { code: "asc" }],
      take: 500,
    });
    return lots.map((lot) => {
      const warehouses = new Map<string, { warehouseId: string; code: string; name: string; quantity: number }>();
      for (const row of lot.stock) {
        const w = warehouses.get(row.warehouse.id) ?? { warehouseId: row.warehouse.id, code: row.warehouse.code, name: row.warehouse.name, quantity: 0 };
        w.quantity += Number(row.quantity);
        warehouses.set(row.warehouse.id, w);
      }
      const list = [...warehouses.values()];
      return {
        id: lot.id,
        code: lot.code,
        product: lot.product,
        receivedAt: lot.receivedAt,
        initialQuantity: Number(lot.initialQuantity),
        balance: list.reduce((s, w) => s + w.quantity, 0),
        warehouses: list,
      };
    });
  }

  /** Mínimo/máximo por producto de un almacén. */
  async limits(warehouseId: string) {
    await this.assertWarehouse(warehouseId);
    const rows = await this.db.hotelWarehouseProductLimit.findMany({
      where: { warehouseId },
      include: { product: { select: { id: true, code: true, name: true } } },
      orderBy: { product: { code: "asc" } },
    });
    return rows.map((r) => ({ productId: r.productId, product: r.product, minStock: Number(r.minStock), maxStock: Number(r.maxStock) }));
  }

  /** Reemplaza los límites del almacén por la lista dada (lo que no viene se borra). */
  async setLimits(warehouseId: string, limits: Array<{ productId: string; minStock: number; maxStock: number }>) {
    await this.assertWarehouse(warehouseId);
    const ids = limits.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "HOTEL_LIMIT_INVALID");
    const found = await this.db.hotelProduct.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    await this.db.$transaction([
      this.db.hotelWarehouseProductLimit.deleteMany({ where: { warehouseId, productId: { notIn: ids } } }),
      ...limits.map((l) =>
        this.db.hotelWarehouseProductLimit.upsert({
          where: { warehouseId_productId: { warehouseId, productId: l.productId } },
          create: { warehouseId, productId: l.productId, minStock: l.minStock, maxStock: l.maxStock },
          update: { minStock: l.minStock, maxStock: l.maxStock },
        })
      ),
    ]);
    return this.limits(warehouseId);
  }

  private async assertWarehouse(id: string) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id }, select: { id: true } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
  }
}
