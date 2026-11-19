import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { deleteObject } from "@core/services/storage";
import {
  DAY_MS,
  HISTORY_RETENTION_DAYS,
  PURGEABLE_EXTRA_STATUSES,
  PURGEABLE_LOAN_STATUSES,
  PURGEABLE_MOVEMENT_STATUSES,
  PURGEABLE_STOCKTAKE_STATUSES,
  PURGEABLE_SUPPLY_REQUEST_STATUSES,
  isDirtyReceiptPurgeable,
  isExtraPurgeable,
  isLoanPurgeable,
  isMovementPurgeable,
  isRoomStatusChangePurgeable,
  isShiftClosePurgeable,
  isSupplyRequestPurgeable,
  retentionCutoff,
} from "./history-retention-rules";

const BATCH_SIZE = 500;

/** Conteo de registros borrados por tabla en una corrida. */
export type RetentionCounts = Record<string, number>;

const mutable = <T extends readonly string[]>(list: T) => [...list] as unknown as string[];
/** Filtro de fecha anterior al corte (las fechas opcionales también cuentan si son nulas). */
const before = (cutoff: Date) => ({ lt: cutoff });
const beforeOrNull = (field: string, cutoff: Date) => ({ OR: [{ [field]: null }, { [field]: { lt: cutoff } }] });

/**
 * Purga de historial de Blancos (más de 60 días). Solo toca registros cerrados de Blancos; no borra
 * existencias (`HotelStock`/`HotelLot`), catálogos ni nada abierto, ni el `AuditLog` general.
 * Cada lote se borra en su propia transacción; los archivos de evidencia se eliminan después
 * de que el borrado en base de datos se confirma.
 */
export class HotelHistoryRetentionService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: PrismaClient = prismaClient) {}

  /** Corre al arrancar (con 2 min de margen) y luego cada 24 h. Nunca tumba el proceso. */
  startDailyPurge(): void {
    if (this.timer) return;
    if (!env.HISTORY_RETENTION_ENABLED) {
      logger.info("[history-retention] disabled (HISTORY_RETENTION_ENABLED=false)");
      return;
    }
    const tick = () => void this.run().catch((err) => logger.error(`[history-retention] ${String(err)}`));
    setTimeout(tick, 120_000).unref();
    this.timer = setInterval(tick, DAY_MS);
    this.timer.unref();
  }

  /** Una pasada completa. Cada tabla falla por separado: un error no detiene a las demás. */
  async run(now: Date = new Date(), days: number = HISTORY_RETENTION_DAYS): Promise<RetentionCounts> {
    const counts: RetentionCounts = {};
    if (this.running) return counts;
    this.running = true;
    try {
      const cutoff = retentionCutoff(now, days);
      // Orden por dependencias: primero lo que referencia (adicionales, préstamos, cortes, recepciones, pedidos) y al final los movimientos.
      const steps: Array<[string, (cutoff: Date) => Promise<number>]> = [
        ["extras", (c) => this.purgeExtras(c)],
        ["towelLoans", (c) => this.purgeLoans(c)],
        ["shiftCloses", (c) => this.purgeShiftCloses(c)],
        ["dirtyReceipts", (c) => this.purgeDirtyReceipts(c)],
        ["supplyRequests", (c) => this.purgeSupplyRequests(c)],
        ["roomStatusChanges", (c) => this.purgeRoomStatusChanges(c)],
        ["movements", (c) => this.purgeMovements(c)],
      ];
      for (const [name, step] of steps) {
        try {
          counts[name] = await step(cutoff);
          if (name === "movements") counts.evidenceFiles = this.lastEvidenceFiles;
        } catch (err) {
          counts[name] = counts[name] ?? 0;
          logger.error(`[history-retention] ${name}: ${String(err)}`);
        }
      }
      logger.info(`[history-retention] cutoff ${cutoff.toISOString()} deleted: ${JSON.stringify(counts)} (evidence files: ${counts.evidenceFiles ?? 0})`);
    } finally {
      this.running = false;
    }
    return counts;
  }

  /** Recorre por lotes (paginación por id) y borra los elegibles; devuelve el total borrado. */
  private async batches<T extends { id: string }>(
    fetch: (afterId: string | undefined) => Promise<T[]>,
    eligible: (rows: T[]) => Promise<T[]> | T[],
    remove: (ids: string[]) => Promise<number>
  ): Promise<number> {
    let total = 0;
    let afterId: string | undefined;
    for (;;) {
      const rows = await fetch(afterId);
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1].id;
      const ok = await eligible(rows);
      if (ok.length > 0) total += await remove(ok.map((r) => r.id));
      if (rows.length < BATCH_SIZE) break;
    }
    return total;
  }

  private page(afterId: string | undefined) {
    return { orderBy: { id: "asc" as const }, take: BATCH_SIZE, ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}) };
  }

  /** Adicionales cerrados (recogidos o cancelados), sin pérdida por huésped ligada. */
  private purgeExtras(cutoff: Date) {
    return this.batches(
      (afterId) =>
        this.db.hotelRoomExtra.findMany({
          where: {
            status: { in: mutable(PURGEABLE_EXTRA_STATUSES) as never },
            guestLossId: null,
            requestedAt: before(cutoff),
            ...beforeOrNull("deliveredAt", cutoff),
            AND: [beforeOrNull("collectedAt", cutoff)],
          },
          select: { id: true, status: true, requestedAt: true, deliveredAt: true, collectedAt: true, guestLossId: true },
          ...this.page(afterId),
        }),
      (rows) => rows.filter((r) => isExtraPurgeable(r, cutoff)),
      async (ids) => (await this.db.hotelRoomExtra.deleteMany({ where: { id: { in: ids }, status: { in: mutable(PURGEABLE_EXTRA_STATUSES) as never }, guestLossId: null } })).count
    );
  }

  /** Préstamos de toallas devueltos del todo (abiertos, parciales y no devueltos se conservan). */
  private purgeLoans(cutoff: Date) {
    return this.batches(
      (afterId) =>
        this.db.hotelTowelLoan.findMany({
          where: { status: { in: mutable(PURGEABLE_LOAN_STATUSES) as never }, guestLossId: null, lentAt: before(cutoff), ...beforeOrNull("returnedAt", cutoff) },
          select: { id: true, status: true, lentAt: true, returnedAt: true, guestLossId: true },
          ...this.page(afterId),
        }),
      (rows) => rows.filter((r) => isLoanPurgeable(r, cutoff)),
      async (ids) => (await this.db.hotelTowelLoan.deleteMany({ where: { id: { in: ids }, status: { in: mutable(PURGEABLE_LOAN_STATUSES) as never } } })).count
    );
  }

  /** Cierres de turno viejos sin préstamos que dependan de ellos (los préstamos conservados los retienen). */
  private purgeShiftCloses(cutoff: Date) {
    return this.batches(
      (afterId) =>
        this.db.hotelShiftClose.findMany({
          where: { createdAt: before(cutoff), to: before(cutoff), ...beforeOrNull("reviewedAt", cutoff), loans: { none: {} } },
          select: { id: true, createdAt: true, to: true, reviewedAt: true },
          ...this.page(afterId),
        }),
      (rows) => rows.filter((r) => isShiftClosePurgeable({ ...r, loanCount: 0 }, cutoff)),
      async (ids) => (await this.db.hotelShiftClose.deleteMany({ where: { id: { in: ids }, loans: { none: {} } } })).count
    );
  }

  /** Recepciones de sucio (las líneas se van en cascada). */
  private purgeDirtyReceipts(cutoff: Date) {
    return this.batches(
      (afterId) =>
        this.db.hotelDirtyReceipt.findMany({
          where: { createdAt: before(cutoff), date: before(cutoff) },
          select: { id: true, createdAt: true, date: true },
          ...this.page(afterId),
        }),
      (rows) => rows.filter((r) => isDirtyReceiptPurgeable(r, cutoff)),
      async (ids) => (await this.db.hotelDirtyReceipt.deleteMany({ where: { id: { in: ids } } })).count
    );
  }

  /** Pedidos a lavandería recibidos o cancelados (los abiertos, incl. READY_FOR_PICKUP e IN_TRANSIT, se conservan). */
  private purgeSupplyRequests(cutoff: Date) {
    const statuses = mutable(PURGEABLE_SUPPLY_REQUEST_STATUSES) as never;
    return this.batches(
      (afterId) =>
        this.db.hotelSupplyRequest.findMany({
          where: { status: { in: statuses }, createdAt: before(cutoff), updatedAt: before(cutoff), date: before(cutoff), ...beforeOrNull("deliveredAt", cutoff) },
          select: { id: true, status: true, createdAt: true, updatedAt: true, date: true, deliveredAt: true },
          ...this.page(afterId),
        }),
      (rows) => rows.filter((r) => isSupplyRequestPurgeable(r, cutoff)),
      async (ids) => (await this.db.hotelSupplyRequest.deleteMany({ where: { id: { in: ids }, status: { in: statuses } } })).count
    );
  }

  /** Cambios de estado de habitación; el más reciente de cada habitación se conserva (es su "desde cuándo"). */
  private purgeRoomStatusChanges(cutoff: Date) {
    return this.batches(
      (afterId) =>
        this.db.hotelRoomStatusChange.findMany({
          where: { createdAt: before(cutoff) },
          select: { id: true, roomId: true, createdAt: true },
          ...this.page(afterId),
        }),
      async (rows) => {
        const latest = await this.db.hotelRoomStatusChange.groupBy({ by: ["roomId"], where: { roomId: { in: [...new Set(rows.map((r) => r.roomId))] } }, _max: { createdAt: true } });
        const maxByRoom = new Map(latest.map((l) => [l.roomId, l._max.createdAt?.getTime()]));
        return rows.filter((r) => isRoomStatusChangePurgeable({ createdAt: r.createdAt, isLatestOfRoom: maxByRoom.get(r.roomId) === r.createdAt.getTime() }, cutoff));
      },
      async (ids) => (await this.db.hotelRoomStatusChange.deleteMany({ where: { id: { in: ids } } })).count
    );
  }

  /**
   * Movimientos cerrados (ACTIVE/CANCELLED) cuyos renglones son todos de Blancos, con sus renglones
   * (cascada) y evidencias (cascada + archivo). Se conservan los que algo conservado referencia:
   * lote origen, ciclo de lavado, tarea de limpieza, préstamo/adicional, recepción de sucio, conteo
   * abierto o documento origen abierto; y los de cobro PENDING o 2ª firma pendiente.
   */
  private async purgeMovements(cutoff: Date): Promise<number> {
    const statuses = mutable(PURGEABLE_MOVEMENT_STATUSES) as never;
    const evidenceKeys: string[] = [];
    let total = 0;
    try {
      total = await this.batches(
      (afterId) =>
        this.db.hotelMovement.findMany({
          where: {
            status: { in: statuses },
            createdAt: before(cutoff),
            updatedAt: before(cutoff),
            date: before(cutoff),
            AND: [
              beforeOrNull("approvedAt", cutoff),
              beforeOrNull("receivedAt", cutoff),
              beforeOrNull("signoffAt", cutoff),
              { OR: [{ signoffStatus: null }, { signoffStatus: { not: "PENDING" } }] },
            ],
            chargeStatus: { not: "PENDING" },
            lines: { some: {}, none: { product: { kind: { not: "LINEN" } } } },
            lotsCreated: { none: {} },
            washCycles: { none: {} },
            taskConsumption: null,
            taskLinen: null,
            towelLoan: null,
            roomExtra: null,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            date: true,
            approvedAt: true,
            receivedAt: true,
            signoffAt: true,
            signoffStatus: true,
            chargeStatus: true,
            sourceDocId: true,
            stocktake: { select: { status: true } },
          },
          ...this.page(afterId),
        }),
      async (rows) => {
        const ids = rows.map((r) => r.id);
        const docIds = [...new Set(rows.map((r) => r.sourceDocId).filter((v): v is string => !!v))];
        const [receipts, extras, openMovements, openRequests] = await Promise.all([
          this.db.hotelDirtyReceipt.findMany({ where: { movementId: { in: ids } }, select: { movementId: true } }),
          this.db.hotelRoomExtra.findMany({ where: { movementId: { in: ids } }, select: { movementId: true } }),
          docIds.length ? this.db.hotelMovement.findMany({ where: { id: { in: docIds }, status: { notIn: statuses } }, select: { id: true } }) : [],
          docIds.length ? this.db.hotelSupplyRequest.findMany({ where: { id: { in: docIds }, status: { notIn: mutable(PURGEABLE_SUPPLY_REQUEST_STATUSES) as never } }, select: { id: true } }) : [],
        ]);
        const referenced = new Set([...receipts.map((r) => r.movementId), ...extras.map((e) => e.movementId)]);
        const openDocs = new Set([...openMovements.map((m) => m.id), ...openRequests.map((r) => r.id)]);
        const lines = await this.db.hotelMovementLine.findMany({ where: { movementId: { in: ids } }, select: { movementId: true, product: { select: { kind: true } } } });
        const kinds = new Map<string, string[]>();
        for (const l of lines) kinds.set(l.movementId, [...(kinds.get(l.movementId) ?? []), l.product.kind]);
        return rows.filter((r) =>
          isMovementPurgeable(
            {
              ...r,
              lineProductKinds: kinds.get(r.id) ?? [],
              referencedByKept: referenced.has(r.id),
              openStocktake: !!r.stocktake && !(PURGEABLE_STOCKTAKE_STATUSES as readonly string[]).includes(r.stocktake.status),
              openSourceDoc: !!r.sourceDocId && openDocs.has(r.sourceDocId),
            },
            cutoff
          )
        );
      },
      (ids) =>
        this.db.$transaction(async (tx: Prisma.TransactionClient) => {
          const evidence = await tx.hotelWriteoffEvidence.findMany({ where: { movementId: { in: ids } }, select: { fileKey: true } });
          const removed = await tx.hotelMovement.deleteMany({ where: { id: { in: ids }, status: { in: statuses } } });
          // Solo se anotan las llaves tras borrar; los archivos se eliminan cuando la transacción confirma.
          if (removed.count > 0) evidenceKeys.push(...evidence.map((e) => e.fileKey));
          return removed.count;
        })
    );
    } finally {
      // Aun si un lote posterior falla, los archivos de lotes ya confirmados se limpian.
      await this.deleteEvidenceFiles(evidenceKeys);
    }
    return total;
  }

  /** Elimina los archivos de evidencia ya sin fila en base de datos; un fallo se registra y no detiene nada. */
  private async deleteEvidenceFiles(keys: string[]): Promise<void> {
    let deleted = 0;
    for (const key of keys) {
      try {
        await deleteObject(key);
        deleted++;
      } catch (err) {
        logger.warn(`[history-retention] could not delete evidence file ${key}: ${String(err)}`);
      }
    }
    this.lastEvidenceFiles = deleted;
  }

  lastEvidenceFiles = 0;
}
