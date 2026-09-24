import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { paginatedTable, type ITDataTableFetchParams } from "@core/utils/table";
import { localDateKey } from "@core/utils/timezone";
import { dateKeyOf, toUtcDate } from "@modules/horarios/services/horario.service";
import type { HorasExtraDayRow } from "@modules/horarios/models/entity/horario.entity";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  OvertimeDayRow,
  OvertimeDayStatus,
  OvertimeSummary,
} from "../models/entity/overtime.entity";
import type { OvertimeApprovalInput } from "../models/dto/overtime.dto";

interface OvertimeRange {
  start: Date;
  end: Date;
  timezone: string;
  period: string;
}

/** Puerto de cálculo: lo implementa `HorarioService.computeOvertimeDays`. */
export interface OvertimeCalculator {
  computeOvertimeDays(params: ITDataTableFetchParams): Promise<{
    days: HorasExtraDayRow[];
    range: OvertimeRange;
  }>;
}

/**
 * Aprobación de tiempo extra por (persona, día). La tabla guarda SOLO
 * decisiones (APROBADO/RECHAZADO); los pendientes se materializan al vuelo
 * desde el cálculo diario del módulo `horarios`.
 */
export class OvertimeService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly calculator: OvertimeCalculator,
    private readonly audit?: AuditLogger
  ) {}

  async query(params: ITDataTableFetchParams): Promise<{
    data: OvertimeDayRow[];
    total: number;
    summary: OvertimeSummary;
  }> {
    const { days, range } = await this.calculator.computeOvertimeDays(params);
    const rows = await this.materialize(days, range);
    const filtered = this.filter(rows, params.filters);
    const ordered = this.sort(filtered, params.sort);
    const from = (params.page - 1) * params.limit;
    return {
      ...paginatedTable(params, ordered.slice(from, from + params.limit), filtered.length),
      summary: this.summaryOf(filtered, range),
    };
  }

  /**
   * Aprueba/rechaza (o revierte a PENDIENTE) los días indicados. Recalcula los
   * días con `filters` para validar existencia y `extraMin > 0`, y guarda el
   * snapshot del cálculo vigente. Devuelve `{ updated, skipped }`.
   */
  async decide(input: OvertimeApprovalInput, actorId?: string): Promise<{ updated: number; skipped: number }> {
    const { days } = await this.calculator.computeOvertimeDays({
      page: 1,
      limit: 100000,
      filters: input.filters ?? {},
      sort: undefined,
    });
    const byKey = new Map<string, HorasExtraDayRow>();
    for (const d of days) byKey.set(`${d.userId}|${d.date}`, d);

    const decidedAt = new Date();
    let updated = 0;
    let skipped = 0;

    for (const item of input.items) {
      const day = byKey.get(`${item.userId}|${item.date}`);
      if (!day || day.extraMin <= 0) {
        skipped += 1;
        continue;
      }
      const date = toUtcDate(item.date);

      if (input.status === "PENDIENTE") {
        await this.db.overtimeApproval.deleteMany({ where: { userId: item.userId, date } });
      } else {
        const snapshot = {
          status: input.status,
          extraMin: day.extraMin,
          horarioNombre: day.horarioNombre,
          programadasMin: day.programadasMin,
          note: input.note ?? null,
          decidedById: actorId ?? null,
          decidedAt,
        };
        await this.db.overtimeApproval.upsert({
          where: { userId_date: { userId: item.userId, date } },
          create: { userId: item.userId, date, ...snapshot },
          update: snapshot,
        });
      }
      updated += 1;
    }

    await this.audit?.({
      action: "OVERTIME_APPROVAL",
      entityType: "OvertimeApproval",
      entityId: "bulk",
      userId: actorId,
      metadata: {
        status: input.status,
        requested: input.items.length,
        updated,
        skipped,
      },
    });

    return { updated, skipped };
  }

  /** Días con extra calculado o con decisión guardada, con su estado. */
  private async materialize(days: HorasExtraDayRow[], range: OvertimeRange): Promise<OvertimeDayRow[]> {
    const userIds = [...new Set(days.map((d) => d.userId))];
    const firstDay = toUtcDate(localDateKey(range.start, range.timezone));
    const lastDay = toUtcDate(localDateKey(new Date(range.end.getTime() - 1), range.timezone));
    const approvals = userIds.length
      ? await this.db.overtimeApproval.findMany({
          where: { userId: { in: userIds }, date: { gte: firstDay, lte: lastDay } },
          include: { decidedBy: { select: { id: true, name: true } } },
        })
      : [];
    const byKey = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) byKey.set(`${a.userId}|${dateKeyOf(a.date)}`, a);

    const rows: OvertimeDayRow[] = [];
    for (const d of days) {
      const ap = byKey.get(`${d.userId}|${d.date}`);
      // Días sin extra ni decisión no son "días de tiempo extra".
      if (d.extraMin <= 0 && !ap) continue;
      const status: OvertimeDayStatus = ap ? ap.status : "PENDIENTE";
      rows.push({
        ...d,
        status,
        approvedExtraMin: ap?.status === "APROBADO" ? ap.extraMin : 0,
        note: ap?.note ?? null,
        decidedById: ap?.decidedById ?? null,
        decidedByName: ap?.decidedBy?.name ?? null,
        decidedAt: ap?.decidedAt?.toISOString() ?? null,
      });
    }
    return rows;
  }

  private filter(
    rows: OvertimeDayRow[],
    filters: Record<string, string | number | boolean>
  ): OvertimeDayRow[] {
    const status = typeof filters.status === "string" ? filters.status : undefined;
    const departmentId = typeof filters.departmentId === "string" ? filters.departmentId : undefined;
    const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";

    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (departmentId && r.departmentId !== departmentId) return false;
      if (q) {
        const text = [r.employeeName, r.numeroEmpleado, r.departmentName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }

  private static readonly SORTABLE_FIELDS = new Set([
    "employeeName",
    "departmentName",
    "date",
    "horarioNombre",
    "extraMin",
    "approvedExtraMin",
    "status",
    "decidedAt",
  ]);

  private sort(rows: OvertimeDayRow[], sort: ITDataTableFetchParams["sort"]): OvertimeDayRow[] {
    // Orden por defecto: día más reciente primero, luego por nombre.
    const fallback = (a: OvertimeDayRow, b: OvertimeDayRow): number =>
      b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName);

    if (!sort || !OvertimeService.SORTABLE_FIELDS.has(sort.key)) return [...rows].sort(fallback);

    const dir = sort.direction === "asc" ? 1 : -1;
    const key = sort.key as keyof OvertimeDayRow;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }

  private summaryOf(rows: OvertimeDayRow[], range: OvertimeRange): OvertimeSummary {
    const pending = rows.filter((r) => r.status === "PENDIENTE");
    const approved = rows.filter((r) => r.status === "APROBADO");
    const rejected = rows.filter((r) => r.status === "RECHAZADO");
    const sum = (list: OvertimeDayRow[], key: "extraMin" | "approvedExtraMin") =>
      list.reduce((acc, r) => acc + r[key], 0);

    return {
      totalDays: rows.length,
      pendingDays: pending.length,
      approvedDays: approved.length,
      rejectedDays: rejected.length,
      pendingMinutes: sum(pending, "extraMin"),
      approvedMinutes: sum(approved, "approvedExtraMin"),
      rejectedMinutes: sum(rejected, "extraMin"),
      peopleWithPending: new Set(pending.map((r) => r.userId)).size,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: range.period,
      },
    };
  }
}
