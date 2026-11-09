import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { HotelLinenStockService } from "./linen-stock.service";
import type { HotelWriteoffService } from "./writeoff.service";
import { WRITEOFF_DOC } from "./writeoff-rules";
import { averageCycles, LAUNDRY_STAGES } from "./laundry-rules";
import {
  aggregateShrinkage,
  lotLifeEstimate,
  periodMonths,
  washRate,
  investmentToPar,
  lineDelta,
  pctOf,
  periodRange,
  round2,
  round3,
  runningBalance,
  sumInvestments,
  towelShortage,
  transferShortage,
  type ShrinkageRow,
} from "./report-rules";

const PRODUCT_SELECT = { id: true, code: true, name: true, size: true, washLife: true } as const;
const num = (v: Prisma.Decimal | number | null | undefined): number => Number(v ?? 0);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Banderas de visibilidad del tablero (permiso -> el usuario lo tiene) y almacenes visibles. */
export interface DashboardScope {
  /** Almacenes visibles con hotel_linen.view; null = todos. */
  visibleIds: string[] | null;
  /** Almacenes donde el usuario puede recibir traspasos; null = todos. */
  receivableIds: string[] | null;
  can: {
    transfers: boolean;
    writeoffReview: boolean;
    writeoffApprove: boolean;
    reconciliation: boolean;
    loans: boolean;
    extras: boolean;
    equipment: boolean;
    requests: boolean;
    purchase: boolean;
    purchaseApprove: boolean;
  };
}

/** Reportes y tablero de blancos (F7): solo lecturas. */
export class HotelLinenReportService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly stock: HotelLinenStockService,
    private readonly writeoffs: HotelWriteoffService
  ) {}

  // ── Tablero ──────────────────────────────────────────────────────────────

  async dashboard(scope: DashboardScope, now: Date = new Date()) {
    const { visibleIds, receivableIds, can } = scope;
    const inWarehouses = (ids: string[] | null) => (ids ? { in: ids } : undefined);
    const either = (ids: string[] | null) => (ids ? { OR: [{ fromWarehouseId: { in: ids } }, { warehouseId: { in: ids } }] } : {});
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const empty = null;
    const transit = can.transfers
      ? await Promise.all([
          this.db.hotelMovement.count({ where: { status: "IN_TRANSIT", sourceDocType: "HOTEL_TRANSFER", ...either(visibleIds) } }),
          this.db.hotelMovement.count({ where: { status: "IN_TRANSIT", sourceDocType: "HOTEL_TRANSFER", ...(receivableIds ? { warehouseId: { in: receivableIds } } : {}) } }),
          this.db.hotelMovement.count({ where: { status: "RECEIVED_WITH_DIFFERENCE", sourceDocType: "HOTEL_TRANSFER", receivedAt: { gte: sevenDaysAgo }, ...either(visibleIds) } }),
        ])
      : [empty, empty, empty];

    let writeoffReview: number | null = empty;
    let writeoffApprove: number | null = empty;
    if (can.writeoffReview || can.writeoffApprove) {
      const pending = await this.db.hotelMovement.findMany({
        where: {
          type: "WRITE_OFF",
          sourceDocType: WRITEOFF_DOC,
          status: "PENDING_APPROVAL",
          ...(visibleIds ? { OR: [{ originWarehouseId: { in: visibleIds } }, { fromWarehouseId: { in: visibleIds } }] } : {}),
        },
        select: { id: true },
      });
      const reviewed = new Set(
        (await this.db.hotelSignature.findMany({ where: { docType: WRITEOFF_DOC, role: "REVIEWS", docId: { in: pending.map((p) => p.id) } }, select: { docId: true } })).map((s) => s.docId)
      );
      if (can.writeoffReview) writeoffReview = pending.filter((p) => !reviewed.has(p.id)).length;
      if (can.writeoffApprove) writeoffApprove = reviewed.size;
    }

    const shortages = can.reconciliation ? await this.todayShortages(visibleIds, dayStart, dayEnd) : empty;

    let towels: { openLoans: number; pending: number; depositsByPoint: Array<{ warehouseId: string; name: string; openLoans: number; pending: number; deposits: number }> } | null = empty;
    if (can.loans) {
      const open = await this.db.hotelTowelLoan.findMany({
        where: { status: { in: ["OPEN", "PARTIAL"] }, ...(visibleIds ? { pointWarehouseId: { in: visibleIds } } : {}) },
        select: { pointWarehouseId: true, pointWarehouse: { select: { name: true } }, quantity: true, returnedQty: true, depositUnit: true },
      });
      const points = new Map<string, { warehouseId: string; name: string; openLoans: number; pending: number; deposits: number }>();
      for (const l of open) {
        const pending = num(l.quantity) - num(l.returnedQty);
        const p = points.get(l.pointWarehouseId) ?? { warehouseId: l.pointWarehouseId, name: l.pointWarehouse.name, openLoans: 0, pending: 0, deposits: 0 };
        p.openLoans += 1;
        p.pending = round3(p.pending + pending);
        p.deposits = round2(p.deposits + pending * num(l.depositUnit));
        points.set(l.pointWarehouseId, p);
      }
      const list = [...points.values()].sort((a, b) => a.name.localeCompare(b.name));
      towels = { openLoans: open.length, pending: round3(list.reduce((s, p) => s + p.pending, 0)), depositsByPoint: list };
    }

    const extras = can.extras
      ? await this.db.hotelRoomExtra.count({
          where: { OR: [{ status: "REQUESTED" }, { status: "DELIVERED", kind: "LINEN" }], ...(visibleIds ? { sourceWarehouseId: { in: visibleIds } } : {}) },
        })
      : empty;

    const equipment = can.equipment
      ? {
          loaned: await this.db.hotelEquipmentUnit.count({ where: { status: "LOANED", ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}) } }),
          inRepair: await this.db.hotelEquipmentUnit.count({ where: { status: "IN_REPAIR", ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}) } }),
        }
      : empty;

    const requests = can.requests
      ? await this.db.hotelSupplyRequest.count({
          where: {
            status: { in: ["SUBMITTED", "PARTIALLY_FULFILLED"] },
            ...(visibleIds ? { OR: [{ sourceWarehouseId: { in: visibleIds } }, { requestingWarehouseId: { in: visibleIds } }] } : {}),
          },
        })
      : empty;

    let belowMin: number | null = empty;
    let ordersToApprove: number | null = empty;
    let holdsDue: number | null = empty;
    if (can.purchase) {
      belowMin = await this.belowMinCount();
      holdsDue = await this.db.hotelPurchaseHold.count({ where: { status: "OPEN", dueAt: { lte: new Date(now.getTime() + 2 * DAY_MS) } } });
    }
    if (can.purchaseApprove) ordersToApprove = await this.db.hotelPurchaseOrder.count({ where: { status: "DRAFT" } });

    // Piezas retenidas en cuarentena esperando autorizacion de baja (ajuste demo v2). Se cuenta por
    // el area de origen para que la supervisora vea sus piezas aunque la cuarentena sea de Lavanderia.
    const quarantineLines = await this.db.hotelMovementLine.findMany({
      where: {
        movement: {
          type: "WRITE_OFF",
          status: "PENDING_APPROVAL",
          sourceDocType: WRITEOFF_DOC,
          ...(visibleIds ? { OR: [{ originWarehouseId: { in: visibleIds } }, { fromWarehouseId: { in: visibleIds } }] } : {}),
        },
        fromLocation: { code: "QUARANTINE" },
      },
      select: { quantity: true },
    });

    return {
      generatedAt: now,
      transfers: can.transfers ? { inTransit: transit[0], receivable: transit[1], withDifference: transit[2] } : null,
      writeoffs: can.writeoffReview || can.writeoffApprove ? { toReview: writeoffReview, toAuthorize: writeoffApprove } : null,
      shortages,
      towels,
      extras,
      equipment,
      requests,
      belowMin,
      purchase: can.purchase ? { ordersToApprove, holdsDue } : null,
      quarantine: round3(quarantineLines.reduce((sum, l) => sum + num(l.quantity), 0)),
      inWarehouses: inWarehouses(visibleIds) ? visibleIds : null,
    };
  }

  /** Faltantes del día de la conciliación de sucios: entregado − recibido − en uso, por área con recepción hoy. */
  private async todayShortages(visibleIds: string[] | null, from: Date, to: Date): Promise<{ areas: number; pieces: number } | null> {
    const receipts = await this.db.hotelDirtyReceipt.findMany({
      where: { date: { gte: from, lt: to }, ...(visibleIds ? { originWarehouseId: { in: visibleIds } } : {}) },
      select: { lines: { select: { shortage: true } }, originWarehouseId: true },
    });
    const byArea = new Map<string, number>();
    for (const r of receipts) byArea.set(r.originWarehouseId, (byArea.get(r.originWarehouseId) ?? 0) + r.lines.reduce((s, l) => s + num(l.shortage), 0));
    const pieces = [...byArea.values()].reduce((s, v) => s + v, 0);
    return { areas: [...byArea.values()].filter((v) => v > 0).length, pieces: round3(pieces) };
  }

  /** Productos bajo mínimo: existencia total (sin tránsito) <= mínimo, con mínimo > 0. */
  private async belowMinCount(): Promise<number> {
    const [products, stock] = await Promise.all([
      this.db.hotelProduct.findMany({ where: { active: true, minStock: { gt: 0 } }, select: { id: true, minStock: true } }),
      this.db.hotelStock.groupBy({ by: ["productId"], where: { quantity: { gt: 0 }, location: { code: { not: "HOLD" } } }, _sum: { quantity: true } }),
    ]);
    const totals = new Map(stock.map((s) => [s.productId, num(s._sum.quantity)]));
    return products.filter((p) => (totals.get(p.id) ?? 0) <= num(p.minStock)).length;
  }

  // ── Par e inversión ──────────────────────────────────────────────────────

  async par(kind?: string) {
    // El par es de blancos: las amenidades de consumo no entran al reporte (ajuste demo v2).
    const summary = await this.stock.summary(null, kind ?? "LINEN");
    const costs = await this.db.hotelProduct.findMany({ where: { id: { in: summary.map((s) => s.productId) } }, select: { id: true, lastCost: true } });
    const costBy = new Map(costs.map((c) => [c.id, c.lastCost === null ? null : num(c.lastCost)]));
    const lines = summary
      .filter((s) => s.par > 0)
      .map((s) => {
        const lastCost = costBy.get(s.productId) ?? null;
        const inv = investmentToPar({ total: s.total, par: s.par, lastCost });
        return {
          productId: s.productId,
          code: s.code,
          name: s.name,
          size: s.size,
          kind: s.kind,
          total: s.total,
          inTransit: s.inTransit,
          par: s.par,
          pct: s.pct === null ? null : round2(s.pct * 100),
          light: s.light,
          lastCost,
          shortfall: inv.shortfall,
          subtotal: inv.subtotal,
          iva16: inv.iva16,
          total16: inv.total16,
          iva8: inv.iva8,
          total8: inv.total8,
        };
      });
    const rows = lines.filter((l) => l.shortfall > 0 && l.lastCost !== null);
    return {
      lines,
      totals: { ...sumInvestments(rows), shortfall: round3(lines.reduce((s, l) => s + l.shortfall, 0)) },
      withoutCost: lines.filter((l) => l.shortfall > 0 && l.lastCost === null).map((l) => ({ productId: l.productId, code: l.code, name: l.name, size: l.size, shortfall: l.shortfall })),
    };
  }

  // ── Estado físico A–E ────────────────────────────────────────────────────

  async condition(warehouseId?: string) {
    const result = await this.writeoffs.condition(warehouseId, null);
    const withPct = (row: { product: { id: string; code: string; name: string; size: string | null }; A: number; B: number; C: number; D: number; E: number; total: number }) => ({
      ...row,
      pct: { A: pctOf(row.A, row.total), B: pctOf(row.B, row.total), C: pctOf(row.C, row.total), D: pctOf(row.D, row.total), E: pctOf(row.E, row.total) },
    });
    const products = result.products.map(withPct).sort((a, b) => a.product.code.localeCompare(b.product.code));
    const sum = (k: "A" | "B" | "C" | "D" | "E" | "total") => products.reduce((s, p) => s + p[k], 0);
    const totals = { A: sum("A"), B: sum("B"), C: sum("C"), D: sum("D"), E: sum("E"), total: sum("total") };
    return {
      warehouses: result.warehouses.map((w) => ({ warehouse: w.warehouse, stocktake: w.stocktake, products: w.products.map(withPct) })),
      products,
      totals: { ...totals, pct: { A: pctOf(totals.A, totals.total), B: pctOf(totals.B, totals.total), C: pctOf(totals.C, totals.total), D: pctOf(totals.D, totals.total), E: pctOf(totals.E, totals.total) } },
    };
  }

  // ── Merma ────────────────────────────────────────────────────────────────

  async shrinkage(from?: string, to?: string) {
    const range = periodRange(from, to);
    const [transfers, counts, loans, writeoffs] = await Promise.all([
      this.db.hotelMovementLine.findMany({
        where: { movement: { status: "RECEIVED_WITH_DIFFERENCE", sourceDocType: "HOTEL_TRANSFER", receivedAt: { gte: range.from, lt: range.to } }, receivedQuantity: { not: null } },
        select: { productId: true, quantity: true, receivedQuantity: true, unitCost: true },
      }),
      this.db.hotelMovementLine.findMany({
        where: { movement: { type: "ADJUST_OUT", status: "ACTIVE", stocktakeId: { not: null }, stocktake: { status: "APPLIED", approvedAt: { gte: range.from, lt: range.to } } } },
        select: { productId: true, quantity: true, unitCost: true },
      }),
      this.db.hotelTowelLoan.findMany({
        where: { status: "UNRETURNED", OR: [{ returnedAt: { gte: range.from, lt: range.to } }, { returnedAt: null, lentAt: { gte: range.from, lt: range.to } }] },
        select: { productId: true, quantity: true, returnedQty: true },
      }),
      this.db.hotelMovementLine.findMany({
        where: { movement: { type: "WRITE_OFF", status: "ACTIVE", sourceDocType: WRITEOFF_DOC, approvedAt: { gte: range.from, lt: range.to } } },
        select: { productId: true, quantity: true, unitCost: true, movement: { select: { reason: { select: { code: true } } } } },
      }),
    ]);
    const productIds = new Set([...transfers, ...counts, ...loans, ...writeoffs].map((l) => l.productId));
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: [...productIds] } }, select: { ...PRODUCT_SELECT, lastCost: true } });
    const productBy = new Map(products.map((p) => [p.id, p]));
    const costOf = (productId: string, own: Prisma.Decimal | null) => (own !== null ? num(own) : productBy.get(productId)?.lastCost != null ? num(productBy.get(productId)!.lastCost) : null);
    const rows: ShrinkageRow[] = [
      ...transfers.map((l) => ({ source: "TRANSFER" as const, productId: l.productId, quantity: transferShortage(num(l.quantity), l.receivedQuantity === null ? null : num(l.receivedQuantity)), unitCost: costOf(l.productId, l.unitCost) })),
      ...counts.map((l) => ({ source: "COUNT" as const, productId: l.productId, quantity: num(l.quantity), unitCost: costOf(l.productId, l.unitCost) })),
      ...loans.map((l) => ({ source: "TOWEL" as const, productId: l.productId, quantity: towelShortage(num(l.quantity), num(l.returnedQty)), unitCost: costOf(l.productId, null) })),
      ...writeoffs.map((l) => ({ source: "WRITEOFF" as const, productId: l.productId, quantity: num(l.quantity), unitCost: costOf(l.productId, l.unitCost), reasonCode: l.movement.reason?.code ?? null })),
    ];
    const agg = aggregateShrinkage(rows);
    return {
      from: range.from,
      to: new Date(range.to.getTime() - 1),
      bySource: agg.bySource,
      byReason: agg.byReason,
      total: agg.total,
      products: agg.byProduct
        .map((p) => ({ ...p, product: productBy.get(p.productId) ? { id: p.productId, code: productBy.get(p.productId)!.code, name: productBy.get(p.productId)!.name, size: productBy.get(p.productId)!.size } : null }))
        .sort((a, b) => b.amount - a.amount || (a.product?.code ?? "").localeCompare(b.product?.code ?? "")),
    };
  }

  // ── Lavandería ───────────────────────────────────────────────────────────

  async laundry(from?: string, to?: string) {
    const range = periodRange(from, to);
    const [cycles, stageRows, lots] = await Promise.all([
      this.db.hotelWashCycle.findMany({ where: { washedAt: { gte: range.from, lt: range.to } }, select: { quantity: true, lot: { select: { id: true, productId: true } } } }),
      this.db.hotelStock.findMany({
        where: { quantity: { gt: 0 }, warehouse: { kind: "LAUNDRY" } },
        select: { productId: true, lotId: true, quantity: true, location: { select: { code: true } } },
      }),
      this.db.hotelLot.findMany({ where: { washCycles: { some: {} } }, select: { id: true, productId: true, initialQuantity: true, washCycles: { select: { quantity: true } } } }),
    ]);
    const productIds = new Set<string>([...cycles.map((c) => c.lot.productId), ...stageRows.map((s) => s.productId), ...lots.map((l) => l.productId)]);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: [...productIds] } }, select: PRODUCT_SELECT, orderBy: { code: "asc" } });
    // Existencia total (incluye transito) para el ritmo de lavado por pieza al mes.
    const summary = await this.stock.summary(null, "LINEN");
    const totalBy = new Map(summary.map((s) => [s.productId, s.total]));
    const months = periodMonths(range.from, range.to);
    const washedBy = new Map<string, number>();
    for (const c of cycles) washedBy.set(c.lot.productId, round3((washedBy.get(c.lot.productId) ?? 0) + num(c.quantity)));
    const cyclesBy = new Map<string, { washed: number; initial: number; lots: number }>();
    for (const l of lots) {
      const e = cyclesBy.get(l.productId) ?? { washed: 0, initial: 0, lots: 0 };
      e.washed += l.washCycles.reduce((s, w) => s + num(w.quantity), 0);
      e.initial += num(l.initialQuantity);
      e.lots += 1;
      cyclesBy.set(l.productId, e);
    }
    const stageBy = new Map<string, Record<string, number>>();
    for (const r of stageRows) {
      const e = stageBy.get(r.productId) ?? Object.fromEntries(LAUNDRY_STAGES.map((s) => [s, 0]));
      e[r.location.code] = round3((e[r.location.code] ?? 0) + num(r.quantity));
      stageBy.set(r.productId, e);
    }
    const lines = products.map((p) => {
      const c = cyclesBy.get(p.id);
      const stages = stageBy.get(p.id) ?? Object.fromEntries(LAUNDRY_STAGES.map((s) => [s, 0]));
      const washed = washedBy.get(p.id) ?? 0;
      const total = totalBy.get(p.id) ?? 0;
      const rate = washRate(washed, total, months);
      return {
        product: p,
        washed,
        lots: c?.lots ?? 0,
        avgCycles: c ? averageCycles(c.washed, c.initial) : 0,
        stages,
        quarantine: stages.QUARANTINE ?? 0,
        totalPieces: round3(total),
        rate: round2(rate),
        washLife: p.washLife ?? null,
      };
    });
    const stageTotals = Object.fromEntries(LAUNDRY_STAGES.map((s) => [s, round3(lines.reduce((sum, l) => sum + (l.stages[s] ?? 0), 0))]));
    const allInitial = lots.reduce((s, l) => s + num(l.initialQuantity), 0);
    const allWashed = lots.reduce((s, l) => s + l.washCycles.reduce((x, w) => x + num(w.quantity), 0), 0);

    // Lotes de compra con vida util usada: antiguedad (meses) x ritmo del articulo / vida util.
    const productBy = new Map(products.map((p) => [p.id, p]));
    const rateBy = new Map(lines.map((l) => [l.product.id, l.rate]));
    const lotRows = await this.db.hotelLot.findMany({
      where: { productId: { in: [...productIds] } },
      select: { id: true, code: true, productId: true, receivedAt: true, initialQuantity: true },
      orderBy: [{ receivedAt: "desc" }, { code: "asc" }],
      take: 300,
    });
    const lotLines = lotRows
      .map((l) => {
        const p = productBy.get(l.productId);
        const wl = p?.washLife ?? null;
        const rate = rateBy.get(l.productId) ?? 0;
        const life = lotLifeEstimate(l.receivedAt, range.to, rate, wl);
        return {
          id: l.id,
          code: l.code,
          product: p ? { id: p.id, code: p.code, name: p.name, size: p.size } : null,
          receivedAt: l.receivedAt,
          initialQuantity: num(l.initialQuantity),
          ...life,
          washLife: wl,
        };
      })
      .filter((l) => l.washLife !== null && l.initialQuantity > 0);

    return {
      from: range.from,
      to: new Date(range.to.getTime() - 1),
      months: round2(months),
      stages: LAUNDRY_STAGES,
      lines,
      lots: lotLines,
      totals: { washed: round3(lines.reduce((s, l) => s + l.washed, 0)), avgCycles: averageCycles(allWashed, allInitial), stages: stageTotals, quarantine: stageTotals.QUARANTINE ?? 0 },
    };
  }

  // ── Conciliacion por area (ajuste demo v2) ───────────────────────────────

  /**
   * Limpios recibidos (traspasos a la zona/punto/Spa) contra sucios enviados a Lavanderia en el
   * periodo. La diferencia son piezas que siguen en uso en el area o que faltan; el conteo fisico
   * confirma cual es cual. La perdida en traspasos sale de los recibidos con diferencia.
   */
  async areaReconciliation(from?: string, to?: string) {
    const range = periodRange(from, to);
    const areas = await this.db.hotelWarehouse.findMany({
      where: { kind: { in: ["ZONE", "POINT", "SPA"] }, active: true },
      select: { id: true, code: true, name: true, kind: true },
      orderBy: { code: "asc" },
    });
    const areaIds = areas.map((a) => a.id);
    const [receivedLines, dirtyLines, lossLines, stockRows] = await Promise.all([
      this.db.hotelMovementLine.findMany({
        where: {
          product: { kind: "LINEN" },
          movement: {
            type: { in: ["TRANSFER", "FIRST_WASH"] },
            status: { in: ["ACTIVE", "RECEIVED_WITH_DIFFERENCE"] },
            warehouseId: { in: areaIds },
            OR: [
              { receivedAt: { gte: range.from, lt: range.to } },
              { receivedAt: null, date: { gte: range.from, lt: range.to } },
            ],
          },
        },
        select: { quantity: true, receivedQuantity: true, movement: { select: { warehouseId: true } } },
      }),
      this.db.hotelDirtyReceiptLine.findMany({
        where: { receipt: { originWarehouseId: { in: areaIds }, date: { gte: range.from, lt: range.to } } },
        select: { receivedDirty: true, receipt: { select: { originWarehouseId: true } } },
      }),
      this.db.hotelMovementLine.findMany({
        where: {
          product: { kind: "LINEN" },
          movement: {
            type: "TRANSFER",
            status: "RECEIVED_WITH_DIFFERENCE",
            receivedAt: { gte: range.from, lt: range.to },
            OR: [{ fromWarehouseId: { in: areaIds } }, { warehouseId: { in: areaIds } }],
          },
        },
        select: {
          quantity: true,
          receivedQuantity: true,
          movement: { select: { fromWarehouseId: true, warehouseId: true } },
        },
      }),
      this.db.hotelStock.groupBy({
        by: ["warehouseId"],
        where: { warehouseId: { in: areaIds }, product: { kind: "LINEN" }, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
    ]);
    const receivedBy = new Map<string, number>();
    for (const l of receivedLines) {
      const id = l.movement.warehouseId;
      if (!id) continue;
      const qty = l.receivedQuantity === null ? num(l.quantity) : num(l.receivedQuantity);
      receivedBy.set(id, round3((receivedBy.get(id) ?? 0) + qty));
    }
    const dirtyBy = new Map<string, number>();
    for (const l of dirtyLines) {
      const id = l.receipt.originWarehouseId;
      dirtyBy.set(id, round3((dirtyBy.get(id) ?? 0) + num(l.receivedDirty)));
    }
    const lossBy = new Map<string, number>();
    for (const l of lossLines) {
      const loss = num(l.quantity) - (l.receivedQuantity === null ? 0 : num(l.receivedQuantity));
      const keys = [l.movement.fromWarehouseId, l.movement.warehouseId].filter((k): k is string => !!k && areaIds.includes(k));
      for (const key of new Set(keys)) lossBy.set(key, round3((lossBy.get(key) ?? 0) + loss));
    }
    const stockBy = new Map(stockRows.map((r) => [r.warehouseId, round3(num(r._sum.quantity))]));
    const rows = areas.map((a) => {
      const received = receivedBy.get(a.id) ?? 0;
      const dirty = dirtyBy.get(a.id) ?? 0;
      return {
        warehouse: a,
        received,
        dirty,
        difference: round3(received - dirty),
        transferLoss: lossBy.get(a.id) ?? 0,
        stock: stockBy.get(a.id) ?? 0,
      };
    });
    const sum = (key: "received" | "dirty" | "difference" | "transferLoss" | "stock") =>
      round3(rows.reduce((s, r) => s + r[key], 0));
    return {
      from: range.from,
      to: new Date(range.to.getTime() - 1),
      rows,
      totals: { received: sum("received"), dirty: sum("dirty"), difference: sum("difference"), transferLoss: sum("transferLoss"), stock: sum("stock") },
    };
  }

  // ── Kardex ───────────────────────────────────────────────────────────────

  async kardex(productId: string | undefined, from?: string, to?: string, warehouseId?: string) {
    if (!productId) throw new HttpError(400, "INVALID_FILTER", { field: "productId" });
    const product = await this.db.hotelProduct.findUnique({ where: { id: productId }, select: PRODUCT_SELECT });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    if (warehouseId) {
      const w = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { id: true } });
      if (!w) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    }
    const range = periodRange(from, to);
    const lines = await this.db.hotelMovementLine.findMany({
      where: {
        productId,
        movement: {
          status: { in: ["ACTIVE", "IN_TRANSIT", "RECEIVED_WITH_DIFFERENCE"] },
          date: { lt: range.to },
          ...(warehouseId ? { OR: [{ fromWarehouseId: warehouseId }, { warehouseId }] } : {}),
        },
      },
      include: {
        lot: { select: { id: true, code: true } },
        movement: { select: { id: true, folio: true, type: true, status: true, date: true, sourceDocType: true, fromWarehouseId: true, warehouseId: true, fromWarehouse: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } } },
      },
      orderBy: [{ movement: { date: "asc" } }, { id: "asc" }],
    });
    const entries = lines
      .map((l) => ({
        date: l.movement.date,
        folio: l.movement.folio,
        type: l.movement.type,
        status: l.movement.status,
        sourceDocType: l.movement.sourceDocType,
        from: l.movement.fromWarehouse,
        to: l.movement.warehouse,
        lot: l.lot,
        quantity: num(l.quantity),
        delta: lineDelta({ quantity: num(l.quantity), receivedQuantity: l.receivedQuantity === null ? null : num(l.receivedQuantity) }, l.movement, warehouseId ?? null),
      }))
      .filter((e) => e.delta !== 0 || warehouseId);
    const withBalance = runningBalance(entries);
    const inPeriod = withBalance.filter((e) => e.date >= range.from);
    const opening = inPeriod.length > 0 ? round3(inPeriod[0].balance - inPeriod[0].delta) : withBalance.length > 0 ? withBalance[withBalance.length - 1].balance : 0;
    return {
      product,
      warehouseId: warehouseId ?? null,
      from: range.from,
      to: new Date(range.to.getTime() - 1),
      opening,
      closing: inPeriod.length > 0 ? inPeriod[inPeriod.length - 1].balance : opening,
      entries: inPeriod,
    };
  }
}
