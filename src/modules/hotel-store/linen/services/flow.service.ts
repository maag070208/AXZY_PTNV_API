import type { HotelProductKind, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { HotelLinenStockService } from "./linen-stock.service";
import { FLOW_STAGES, buildFlowRows, emptyStages, flowMismatches, type FlowStockCell } from "./flow-rules";

const KINDS: HotelProductKind[] = ["CONSUMABLE", "LINEN", "EQUIPMENT"];

/** Tablero de flujo: dónde está cada pieza (7 etapas + tránsito) con detalle por artículo que cuadra con el resumen de existencias. */
export class HotelLinenFlowService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly stock: HotelLinenStockService
  ) {}

  async board(kind: string = "LINEN") {
    if (!KINDS.includes(kind as HotelProductKind)) throw new HttpError(400, "INVALID_FILTER", { field: "kind" });
    const [products, stockRows, transit, extras, summary] = await Promise.all([
      this.db.hotelProduct.findMany({
        where: { active: true, kind: kind as HotelProductKind },
        select: { id: true, code: true, name: true, size: true },
        orderBy: { code: "asc" },
      }),
      this.db.hotelStock.findMany({
        where: { quantity: { gt: 0 }, product: { active: true, kind: kind as HotelProductKind } },
        select: { productId: true, quantity: true, warehouse: { select: { kind: true } }, location: { select: { code: true } } },
      }),
      this.db.hotelMovementLine.findMany({
        where: { movement: { status: "IN_TRANSIT" }, product: { active: true, kind: kind as HotelProductKind } },
        select: { productId: true, quantity: true },
      }),
      this.db.hotelRoomExtra.findMany({
        where: { status: "DELIVERED", product: { active: true, kind: kind as HotelProductKind } },
        select: { productId: true, quantity: true },
      }),
      this.stock.summary(null, kind),
    ]);
    const sum = (rows: Array<{ productId: string; quantity: unknown }>) => {
      const out = new Map<string, number>();
      for (const r of rows) out.set(r.productId, (out.get(r.productId) ?? 0) + Number(r.quantity));
      return out;
    };
    const cells: FlowStockCell[] = stockRows.map((s) => ({ productId: s.productId, warehouseKind: s.warehouse.kind, locationCode: s.location.code, quantity: Number(s.quantity) }));
    const rows = buildFlowRows(products.map((p) => p.id), cells, sum(extras), sum(transit));
    const byId = new Map(products.map((p) => [p.id, p]));

    const totals = { stages: emptyStages(), inRooms: 0, other: 0, inTransit: 0, total: 0 };
    for (const r of rows) {
      for (const st of FLOW_STAGES) totals.stages[st] += r.stages[st];
      totals.inRooms += r.inRooms;
      totals.other += r.other;
      totals.inTransit += r.inTransit;
      totals.total += r.total;
    }
    // Lo que está en habitaciones no figura en /stock/summary (ya salió del almacén).
    const summaryTotals = new Map(summary.map((x) => [x.productId, x.total]));
    const mismatches = flowMismatches(rows, summaryTotals);
    const summaryTotal = summary.reduce((s, x) => s + x.total, 0);
    return {
      kind,
      stages: FLOW_STAGES,
      totals,
      reconciled: mismatches.length === 0,
      mismatches,
      summaryTotal,
      items: rows
        .map((r) => ({ ...r, code: byId.get(r.productId)!.code, name: byId.get(r.productId)!.name, size: byId.get(r.productId)!.size }))
        .filter((r) => r.total > 0),
    };
  }
}
