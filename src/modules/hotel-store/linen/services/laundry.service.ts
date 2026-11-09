import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { assertWholeQuantity } from "../../services/hotel-catalog-rules";
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelLinenTransferService } from "./transfer.service";
import type { HotelFirstWashInput, HotelLaundryProcessInput, HotelSupplierReturnInput } from "../models/dto/laundry.dto";
import { averageCycles, assertStageTransition, LAUNDRY_STAGES } from "./laundry-rules";
import { locationIdByCode, locationIdsOf, runSerializable, warehouseOfKind } from "./linen-locations";

export const LAUNDRY_PROCESS_DOC = "HOTEL_LAUNDRY_PROCESS";

/** Proceso de lavandería: etapas (ubicaciones de LAUNDRY), primera lavada, devolución a proveedor y tablero. */
export class HotelLaundryService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly transfers: HotelLinenTransferService,
    private readonly audit?: AuditLogger
  ) {}

  /** Lavandería activa (404/422 si no hay). */
  laundry() {
    return warehouseOfKind(this.db, "LAUNDRY", null, "HOTEL_LAUNDRY_NOT_CONFIGURED");
  }

  /**
   * Mueve piezas entre etapas dentro de la lavandería: un TRANSFER interno ACTIVE (sin doble
   * firma). Al llegar a CLEAN registra un ciclo de lavado por lote (D7).
   */
  async process(input: HotelLaundryProcessInput, actorId: string) {
    const laundry = await this.laundry();
    for (const move of input.moves) assertStageTransition(move.from, move.to);
    const locations = await locationIdsOf(this.db, laundry.id);
    const idOf = (code: string) => {
      const id = locations.get(code);
      if (!id) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code });
      return id;
    };
    const products = await this.db.hotelProduct.findMany({
      where: { id: { in: input.moves.map((m) => m.productId) } },
      select: { id: true, code: true, unit: { select: { whole: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const move of input.moves) {
      const product = byId.get(move.productId);
      if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
      assertWholeQuantity(move.quantity, product.unit.whole);
    }

    const stainCodes = input.moves.filter((m) => m.treatment === "STAIN").map((m) => byId.get(m.productId)!.code);
    const notes = [input.notes?.trim(), stainCodes.length ? `Desmanchado: ${[...new Set(stainCodes)].join(", ")}` : ""].filter(Boolean).join(" | ") || null;
    const movementInput = {
      type: "TRANSFER" as const,
      fromWarehouseId: laundry.id,
      warehouseId: laundry.id,
      sourceDocType: LAUNDRY_PROCESS_DOC,
      notes,
      lines: input.moves.map((m) => ({
        productId: m.productId,
        quantity: m.quantity,
        lotId: m.lotId ?? null,
        fromLocationId: idOf(m.from),
        toLocationId: idOf(m.to),
      })),
    };
    assertMovementShape("TRANSFER", movementInput);
    const cleanId = idOf("CLEAN");

    const movement = await runSerializable(async (tx) => {
      const created = await this.movements.applyInTransaction(tx, movementInput, actorId, null);
      // Ciclo de lavado: lo que termina en CLEAN, por lote.
      for (const line of created.lines.filter((l) => l.toLocationId === cleanId)) {
        await tx.hotelWashCycle.create({ data: { lotId: line.lotId, quantity: line.quantity, movementId: created.id } });
      }
      return created;
    }, this.db);

    await this.audit?.({
      action: "HOTEL_LINEN_LAUNDRY_PROCESSED",
      entityType: "HotelMovement",
      entityId: movement.id,
      userId: actorId,
      newState: {
        folio: movement.folio,
        moves: input.moves.map((m) => ({ productId: m.productId, from: m.from, to: m.to, quantity: m.quantity, treatment: m.treatment ?? null })),
      },
    });
    return { id: movement.id, folio: movement.folio, status: movement.status, lines: movement.lines.length };
  }

  /** Primera lavada: bodega de nuevos (GENERAL) -> lavandería (IN_PROCESS) en tránsito; lavandería recibe contando. */
  async firstWash(input: HotelFirstWashInput, actorId: string, requestId?: string | null) {
    const origin = await warehouseOfKind(this.db, "NEW_LINEN", input.fromWarehouseId, "HOTEL_FIRST_WASH_ORIGIN_INVALID");
    const laundry = await warehouseOfKind(this.db, "LAUNDRY", input.toWarehouseId, "HOTEL_LAUNDRY_NOT_CONFIGURED");
    const fromLocationId = await locationIdByCode(this.db, origin.id, "GENERAL");
    const toLocationId = await locationIdByCode(this.db, laundry.id, "IN_PROCESS");
    return this.transfers.send(
      {
        fromWarehouseId: origin.id,
        toWarehouseId: laundry.id,
        notes: input.notes,
        cosignToken: input.cosignToken,
        lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, lotId: l.lotId, fromLocationId, toLocationId })),
      },
      actorId,
      requestId,
      { type: "FIRST_WASH" }
    );
  }

  /** Defecto de fábrica: lavandería (cualquier etapa) -> central (HOLD) en tránsito, con notas. */
  async supplierReturn(input: HotelSupplierReturnInput, actorId: string, requestId?: string | null) {
    const laundry = await this.laundry();
    const central = input.toWarehouseId
      ? await warehouseOfKind(this.db, "CENTRAL", input.toWarehouseId, "HOTEL_SUPPLIER_RETURN_DESTINATION_INVALID")
      : (await this.db.hotelWarehouse.findFirst({ where: { kind: "CENTRAL", active: true, code: "ALM" }, select: { id: true, code: true, kind: true, active: true, zoneId: true } })) ??
        (await warehouseOfKind(this.db, "CENTRAL", null, "HOTEL_SUPPLIER_RETURN_DESTINATION_INVALID"));
    const locations = await locationIdsOf(this.db, laundry.id);
    const toLocationId = await locationIdByCode(this.db, central.id, "HOLD");
    return this.transfers.send(
      {
        fromWarehouseId: laundry.id,
        toWarehouseId: central.id,
        notes: input.notes,
        cosignToken: input.cosignToken,
        lines: input.lines.map((l) => {
          const fromLocationId = locations.get(l.fromStage);
          if (!fromLocationId) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: l.fromStage });
          return { productId: l.productId, quantity: l.quantity, lotId: l.lotId, fromLocationId, toLocationId };
        }),
      },
      actorId,
      requestId,
      { type: "SUPPLIER_RETURN" }
    );
  }

  /**
   * Tablero: saldo por etapa × producto de la lavandería, con los lotes de cada producto y los
   * ciclos promedio por lote (Σ lavadas ÷ cantidad inicial).
   */
  async board() {
    const laundry = await this.laundry();
    const rows = await this.db.hotelStock.findMany({
      where: { warehouseId: laundry.id, quantity: { gt: 0 } },
      include: {
        location: { select: { code: true } },
        product: { select: { id: true, code: true, name: true, size: true } },
        lot: { select: { id: true, code: true, receivedAt: true, initialQuantity: true } },
      },
    });
    const washed = await this.db.hotelWashCycle.groupBy({
      by: ["lotId"],
      where: { lotId: { in: [...new Set(rows.map((r) => r.lotId))] } },
      _sum: { quantity: true },
    });
    const washedBy = new Map(washed.map((w) => [w.lotId, Number(w._sum.quantity ?? 0)]));
    const emptyStages = () => Object.fromEntries(LAUNDRY_STAGES.map((s) => [s, 0])) as Record<string, number>;

    const products = new Map<string, {
      product: (typeof rows)[number]["product"];
      stages: Record<string, number>;
      lots: Map<string, { lotId: string; code: string; receivedAt: Date; initialQuantity: number; stages: Record<string, number>; washedQuantity: number; cycles: number }>;
    }>();
    const totals = emptyStages();
    for (const row of rows) {
      const quantity = Number(row.quantity);
      const entry = products.get(row.productId) ?? { product: row.product, stages: emptyStages(), lots: new Map() };
      entry.stages[row.location.code] = (entry.stages[row.location.code] ?? 0) + quantity;
      totals[row.location.code] = (totals[row.location.code] ?? 0) + quantity;
      const initial = Number(row.lot.initialQuantity);
      const lot = entry.lots.get(row.lotId) ?? {
        lotId: row.lotId,
        code: row.lot.code,
        receivedAt: row.lot.receivedAt,
        initialQuantity: initial,
        stages: emptyStages(),
        washedQuantity: washedBy.get(row.lotId) ?? 0,
        cycles: averageCycles(washedBy.get(row.lotId) ?? 0, initial),
      };
      lot.stages[row.location.code] = (lot.stages[row.location.code] ?? 0) + quantity;
      entry.lots.set(row.lotId, lot);
      products.set(row.productId, entry);
    }

    return {
      warehouse: { id: laundry.id, code: laundry.code },
      stages: LAUNDRY_STAGES,
      totals,
      products: [...products.values()]
        .map((p) => {
          const lots = [...p.lots.values()].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.code.localeCompare(b.code));
          const washedQuantity = lots.reduce((s, l) => s + l.washedQuantity, 0);
          const initial = lots.reduce((s, l) => s + l.initialQuantity, 0);
          return {
            product: p.product,
            stages: p.stages,
            total: Object.values(p.stages).reduce((s, n) => s + n, 0),
            averageCycles: averageCycles(washedQuantity, initial),
            lots,
          };
        })
        .sort((a, b) => a.product.code.localeCompare(b.product.code)),
    };
  }
}
