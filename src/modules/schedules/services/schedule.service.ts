import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, orderByOf, type ITDataTableFetchParams, type ITDataTableResponse } from "@core/utils/table";
import {
  assertDateKey,
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  startOfLocalDay,
  type ReportPeriod,
} from "@core/utils/timezone";
import { TimeClockReportService } from "@modules/time-clock/services/time-clock-report.service";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  ScheduleOvertimeDay,
  ScheduleOvertimeRow,
  ScheduleOvertimeSummary,
} from "../models/entity/schedule.entity";
import type { AssignmentCreateInput, ScheduleCreateInput, ScheduleUpdateInput } from "../models/dto/schedule.dto";

type SysConfigReader = (key: string) => Promise<string | null>;

const MS_PER_MINUTE = 60 * 1000;

/** "HH:mm" → minutos desde medianoche. */
const toMinutes = (hhmm: string | null): number => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Día de la semana 1..7 (1=Lunes) de una clave `YYYY-MM-DD`. */
const weekdayOf = (dayKey: string): number => {
  const js = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0=Dom
  return js === 0 ? 7 : js;
};

/** Día local `YYYY-MM-DD` como instante UTC-medianoche (mismo criterio que `AsignacionHorario.desde`). */
export const toUtcDate = (dayKey: string): Date => new Date(`${dayKey}T00:00:00.000Z`);

/** Clave `YYYY-MM-DD` de una fecha guardada como UTC-medianoche. */
export const dateKeyOf = (date: Date): string => date.toISOString().slice(0, 10);

const minutesBetween = (from: string | null, to: string | null): number => {
  if (!from || !to) return 0;
  const diff = toMinutes(to) - toMinutes(from);
  return diff > 0 ? diff : diff + 24 * 60; // tramo que cruza medianoche
};

export class ScheduleService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly timeClockReport: TimeClockReportService = new TimeClockReportService(prismaClient),
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  // ── Catálogo ────────────────────────────────────────────────────────────

  async list(includeInactive = false) {
    const rows = await this.db.schedule.findMany({
      where: includeInactive ? {} : { active: true },
      include: {
        days: { orderBy: { weekday: "asc" } },
        _count: { select: { assignments: { where: { validTo: null } } } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((h) => ({ ...h, assigned: h._count.assignments }));
  }

  private normalizeDay(d: ScheduleCreateInput["days"][number]) {
    const restDay = d.restDay ?? false;
    return {
      weekday: d.weekday,
      restDay,
      startTime: restDay ? null : d.startTime ?? null,
      endTime: restDay ? null : d.endTime ?? null,
      splitStartTime: restDay ? null : d.splitStartTime ?? null,
      splitEndTime: restDay ? null : d.splitEndTime ?? null,
    };
  }

  async create(data: ScheduleCreateInput) {
    const dup = await this.db.schedule.findUnique({ where: { name: data.name } });
    if (dup) throw new HttpError(409, "SCHEDULE_NAME_TAKEN");

    return this.db.schedule.create({
      data: {
        name: data.name,
        entryToleranceMin: data.entryToleranceMin ?? 10,
        exitToleranceMin: data.exitToleranceMin ?? 10,
        mealBreakMin: data.mealBreakMin ?? 0,
        minOvertimeMin: data.minOvertimeMin ?? 60,
        crossesMidnight: data.crossesMidnight ?? false,
        days: { create: data.days.map((d) => this.normalizeDay(d)) },
      },
      include: { days: { orderBy: { weekday: "asc" } } },
    });
  }

  async update(id: string, data: ScheduleUpdateInput) {
    const schedule = await this.db.schedule.findUnique({ where: { id } });
    if (!schedule) throw new HttpError(404, "SCHEDULE_NOT_FOUND");

    if (data.name && data.name !== schedule.name) {
      const dup = await this.db.schedule.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new HttpError(409, "SCHEDULE_NAME_TAKEN");
    }

    return this.db.$transaction(async (tx) => {
      if (data.days) {
        await tx.scheduleDay.deleteMany({ where: { scheduleId: id } });
      }
      return tx.schedule.update({
        where: { id },
        data: {
          name: data.name,
          entryToleranceMin: data.entryToleranceMin,
          exitToleranceMin: data.exitToleranceMin,
          mealBreakMin: data.mealBreakMin,
          minOvertimeMin: data.minOvertimeMin,
          crossesMidnight: data.crossesMidnight,
          active: data.active,
          ...(data.days ? { days: { create: data.days.map((d) => this.normalizeDay(d)) } } : {}),
        },
        include: { days: { orderBy: { weekday: "asc" } } },
      });
    });
  }

  async remove(id: string) {
    const schedule = await this.db.schedule.findUnique({ where: { id } });
    if (!schedule) throw new HttpError(404, "SCHEDULE_NOT_FOUND");

    const assigned = await this.db.scheduleAssignment.count({ where: { scheduleId: id, validTo: null } });
    if (assigned > 0 || schedule.active) {
      const data = await this.db.schedule.update({ where: { id }, data: { active: false } });
      return { soft: true, data };
    }
    const data = await this.db.schedule.delete({ where: { id } });
    return { soft: false, data };
  }

  // ── Asignación ──────────────────────────────────────────────────────────

  /** Asigna un horario a N personas desde una fecha, cerrando la vigencia previa. */
  async assignBulk(data: AssignmentCreateInput, actorId?: string) {
    const schedule = await this.db.schedule.findUnique({ where: { id: data.scheduleId } });
    if (!schedule || !schedule.active) throw new HttpError(400, "INVALID_SCHEDULE");

    const userIds = [...new Set(data.userIds)];
    const users = await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    const valid = users.map((u) => u.id);
    if (valid.length === 0) throw new HttpError(400, "NO_VALID_ASSIGNEES");

    const from = toUtcDate(data.from);
    const dayBefore = new Date(from.getTime() - 24 * 60 * MS_PER_MINUTE);

    const assigned = await this.db.$transaction(async (tx) => {
      // Cierra las asignaciones que cubren la fecha `desde`.
      await tx.scheduleAssignment.updateMany({
        where: {
          userId: { in: valid },
          validFrom: { lte: from },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
        data: { validTo: dayBefore },
      });
      const created = await tx.scheduleAssignment.createMany({
        data: valid.map((userId) => ({
          userId,
          scheduleId: data.scheduleId,
          validFrom: from,
          createdById: actorId ?? null,
        })),
      });
      return created.count;
    });

    await this.audit?.({
      action: "SCHEDULE_ASSIGNED",
      entityType: "Schedule",
      entityId: schedule.id,
      userId: actorId,
      metadata: { assigned, schedule: schedule.name, from: data.from },
    });

    return { assigned, schedule: schedule.name, from: data.from };
  }

  /** Personas con asignación vigente (hasta = null) de un horario. */
  async scheduleAssignees(scheduleId: string) {
    const rows = await this.db.scheduleAssignment.findMany({
      where: { scheduleId, validTo: null },
      include: { user: { select: { id: true, name: true, employeeNumber: true } } },
      orderBy: { user: { name: "asc" } },
    });
    return rows.map((a) => ({
      userId: a.userId,
      employeeName: a.user?.name ?? "—",
      employeeNumber: a.user?.employeeNumber ?? null,
    }));
  }

  /** Quita (cierra la vigencia) la asignación de varias personas a un horario. */
  async removeBulk(data: { scheduleId: string; userIds: string[] }, actorId?: string) {
    const userIds = [...new Set(data.userIds)];
    if (userIds.length === 0) return { removed: 0 };

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));

    const res = await this.db.scheduleAssignment.updateMany({
      where: { scheduleId: data.scheduleId, userId: { in: userIds }, validTo: null },
      data: { validTo: to },
    });

    await this.audit?.({
      action: "SCHEDULE_UNASSIGNED",
      entityType: "Schedule",
      entityId: data.scheduleId,
      userId: actorId,
      metadata: { removed: res.count },
    });

    return { removed: res.count };
  }

  async assignmentsTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<unknown>> {    const { filters } = params;
    const where: Record<string, unknown> = { validTo: null };
    if (filters.scheduleId) where.scheduleId = String(filters.scheduleId);
    if (filters.departmentId) where.user = { departmentId: String(filters.departmentId) };
    if (typeof filters.q === "string" && filters.q.trim() !== "") {
      where.user = { ...(where.user as object), OR: [{ name: ci(filters.q) }, { employeeNumber: ci(filters.q) }] };
    }

    const orderBy = orderByOf(params.sort, { from: "validFrom" }, [{ validFrom: "desc" }]);

    const [total, data] = await this.db.$transaction([
      this.db.scheduleAssignment.count({ where: where as never }),
      this.db.scheduleAssignment.findMany({
        where: where as never,
        include: {
          user: { select: { id: true, name: true, employeeNumber: true, department: { select: { id: true, name: true } } } },
          schedule: { select: { id: true, name: true } },
        },
        orderBy: orderBy as never,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    ]);

    const rows = data.map((a) => ({
      id: a.id,
      userId: a.userId,
      employeeName: a.user?.name ?? "—",
      employeeNumber: a.user?.employeeNumber ?? null,
      departmentId: a.user?.department?.id ?? null,
      departmentName: a.user?.department?.name ?? null,
      scheduleId: a.scheduleId,
      scheduleName: a.schedule?.name ?? "—",
      from: a.validFrom,
    }));

    return { data: rows, total };
  }

  // ── Horas extra ─────────────────────────────────────────────────────────

  private async resolveRange(filters: Record<string, string | number | boolean>) {
    const rawPeriod = filters.period;
    if (rawPeriod !== "DAY" && rawPeriod !== "WEEK" && rawPeriod !== "MONTH") {
      throw new HttpError(400, "INVALID_REPORT_PERIOD");
    }
    const dateKey = assertDateKey(filters.date, "INVALID_REPORT_DATE");
    const explicitTz = typeof filters.tz === "string" && filters.tz !== "" ? filters.tz : undefined;
    const timezone = await resolveTimezoneWithConfig(explicitTz, this.sysConfig);
    const { start, end } = resolveReportRange(rawPeriod, dateKey, timezone);
    return { start, end, timezone, period: rawPeriod as ReportPeriod };
  }

  /** Campos permitidos para ordenar el reporte (evita keys arbitrarias del cliente). */
  private static readonly SORTABLE_FIELDS = new Set([
    "employeeName",
    "departmentName",
    "scheduleName",
    "extraMin",
    "workedMin",
    "scheduledMin",
    "daysWithExtra",
    "approvedMin",
    "pendingMin",
    "rejectedMin",
    "approvedDays",
    "pendingDays",
    "rejectedDays",
  ]);

  /**
   * Ordena en memoria las filas del reporte según `sort` del ITDataTable.
   * Key fuera del allowlist o sin `sort` → devuelve el orden por defecto
   * (`extraMin desc`) que ya trae `computeHorasExtra`.
   */
  private applySort(rows: ScheduleOvertimeRow[], sort: ITDataTableFetchParams["sort"]): ScheduleOvertimeRow[] {
    if (!sort || !ScheduleService.SORTABLE_FIELDS.has(sort.key)) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    const key = sort.key as keyof ScheduleOvertimeRow;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }

  /**
   * Horas extra = tiempo trabajado DESPUÉS de la salida programada (+tolerancia).
   * Entrar antes de la hora no genera extra.
   */
  async overtime(params: ITDataTableFetchParams): Promise<{
    data: ScheduleOvertimeRow[];
    total: number;
    summary: ScheduleOvertimeSummary;
  }> {
    const { sorted, summary } = await this.computeOvertime(params);
    const ordered = this.applySort(sorted, params.sort);
    const from = (params.page - 1) * params.limit;
    return { data: ordered.slice(from, from + params.limit), total: ordered.length, summary };
  }

  /**
   * Export de la pantalla única de tiempo extra. Con `approvedOnly` (default)
   * devuelve SOLO a quien tiene minutos aprobados, enmascarando el cálculo
   * (`extraMin`) por el snapshot aprobado y dejando pendiente/rechazado en 0.
   * El resumen se recalcula sobre esas filas.
   */
  async overtimeExport(
    params: ITDataTableFetchParams,
    approvedOnly = true
  ): Promise<{
    data: ScheduleOvertimeRow[];
    total: number;
    summary: ScheduleOvertimeSummary;
  }> {
    const { sorted, summary } = await this.computeOvertime(params);
    if (!approvedOnly) {
      return { data: sorted, total: sorted.length, summary };
    }

    const data = sorted
      .filter((r) => r.approvedMin > 0)
      .map((r) => ({
        ...r,
        extraMin: r.approvedMin,
        pendingMin: 0,
        rejectedMin: 0,
        pendingDays: 0,
        rejectedDays: 0,
        daysWithExtra: r.approvedDays,
      }));

    const totalApprovedMinutes = data.reduce((acc, r) => acc + r.approvedMin, 0);

    return {
      data,
      total: data.length,
      summary: {
        ...summary,
        peopleTotal: data.length,
        peopleWithExtra: data.length,
        totalExtraMinutes: totalApprovedMinutes,
        totalApprovedMinutes,
        totalPendingMinutes: 0,
        totalRejectedMinutes: 0,
      },
    };
  }

  /**
   * Cálculo diario del tiempo extra: una fila por (persona, día) del periodo.
   * Fuente = checadas del reloj (`ChecadorReportService`), NO la bitácora del
   * guardia. Solo se consideran las personas vinculadas a un usuario; las filas
   * `reloj:<número>` no tienen horario asignado ni se pueden aprobar.
   *
   * Es público porque el módulo de aprobación de tiempo extra lo reutiliza para
   * materializar al vuelo los pendientes.
   */
  async computeOvertimeDays(params: ITDataTableFetchParams): Promise<{
    days: ScheduleOvertimeDay[];
    range: { start: Date; end: Date; timezone: string; period: ReportPeriod };
  }> {
    const range = await this.resolveRange(params.filters);

    // Sesiones del periodo desde el reloj (una fila por sesión).
    const sessionsRes = await this.timeClockReport.reportExport({
      page: 1,
      limit: 100000,
      filters: params.filters,
      sort: undefined,
    });
    const sessions = sessionsRes.data.filter((s) => s.linked === true);

    const byPerson = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const list = byPerson.get(s.employeeId);
      if (list) list.push(s);
      else byPerson.set(s.employeeId, [s]);
    }

    const userIds = [...byPerson.keys()];
    const assignments = userIds.length
      ? await this.db.scheduleAssignment.findMany({
          where: {
            userId: { in: userIds },
            validFrom: { lt: range.end },
            OR: [{ validTo: null }, { validTo: { gte: range.start } }],
          },
          include: { schedule: { include: { days: true } } },
          orderBy: { validFrom: "asc" },
        })
      : [];

    const days: ScheduleOvertimeDay[] = [];

    for (const [userId, personSessions] of byPerson) {
      const first = personSessions[0];
      const personAssignments = assignments.filter((a) => a.userId === userId);

      // Sesiones agrupadas por día local.
      const byDay = new Map<string, typeof personSessions>();
      for (const s of personSessions) {
        const list = byDay.get(s.date);
        if (list) list.push(s);
        else byDay.set(s.date, [s]);
      }

      for (const [dayKey, daySessions] of byDay) {
        const worked = daySessions.reduce((acc, s) => acc + s.workedMinutes, 0);

        const dayStartMs = toUtcDate(dayKey).getTime();
        const assignment = personAssignments.find(
          (a) => a.validFrom.getTime() <= dayStartMs && (!a.validTo || a.validTo.getTime() >= dayStartMs)
        );

        let extraMin = 0;
        let scheduledMin = 0;
        let restDay = false;
        let scheduleName: string | null = null;

        if (assignment) {
          scheduleName = assignment.schedule.name;
          const day = assignment.schedule.days.find((d) => d.weekday === weekdayOf(dayKey));
          if (!day || day.restDay) {
            // Día de descanso: lo trabajado cuenta como extra si alcanza el mínimo.
            restDay = true;
            if (worked > 0 && worked >= assignment.schedule.minOvertimeMin) extraMin += worked;
          } else {
            const sched =
              minutesBetween(day.startTime, day.endTime) +
              (day.splitStartTime && day.splitEndTime ? minutesBetween(day.splitStartTime, day.splitEndTime) : 0) -
              assignment.schedule.mealBreakMin;
            scheduledMin = Math.max(0, sched);

            // Salida programada (último tramo) como instante local.
            const scheduledEnd = day.splitEndTime ?? day.endTime;
            if (scheduledEnd) {
              const crosses = assignment.schedule.crossesMidnight || toMinutes(scheduledEnd) <= toMinutes(day.startTime);
              const exitMs =
                startOfLocalDay(dayKey, range.timezone).getTime() +
                (toMinutes(scheduledEnd) + (crosses ? 24 * 60 : 0)) * MS_PER_MINUTE;

              const lastExit = daySessions
                .map((s) => (s.exitAt ? new Date(s.exitAt).getTime() : 0))
                .reduce((a, b) => Math.max(a, b), 0);
              if (lastExit > 0) {
                const afterExit = Math.round((lastExit - exitMs) / MS_PER_MINUTE);
                const dayExtra = Math.max(0, afterExit - assignment.schedule.exitToleranceMin);
                if (dayExtra > 0 && dayExtra >= assignment.schedule.minOvertimeMin) extraMin += dayExtra;
              }
            }
          }
        }

        days.push({
          userId,
          employeeName: first.employeeName,
          employeeNumber: first.employeeNumber,
          departmentId: first.departmentId,
          departmentName: first.departmentName,
          active: first.active,
          date: dayKey,
          extraMin,
          workedMin: worked,
          scheduledMin,
          scheduleName,
          restDay,
          withoutSchedule: !assignment,
        });
      }
    }

    return { days, range };
  }

  /**
   * Agrega el cálculo diario por persona y recontabiliza con las decisiones
   * guardadas en `overtime_approvals`:
   * - `aprobadoMin`/`rechazadoMin` = suma de snapshots APROBADO/RECHAZADO.
   * - `pendienteMin` = suma del `extraMin` calculado de los días SIN fila.
   * `extraMin` sigue siendo el CALCULADO (no cambia de significado).
   */
  private async computeOvertime(params: ITDataTableFetchParams): Promise<{
    sorted: ScheduleOvertimeRow[];
    summary: ScheduleOvertimeSummary;
  }> {
    const { days, range } = await this.computeOvertimeDays(params);

    const byPerson = new Map<string, ScheduleOvertimeDay[]>();
    for (const d of days) {
      const list = byPerson.get(d.userId);
      if (list) list.push(d);
      else byPerson.set(d.userId, [d]);
    }

    const userIds = [...byPerson.keys()];
    // Rango de días locales del periodo para leer las decisiones guardadas.
    const firstDay = toUtcDate(localDateKey(range.start, range.timezone));
    const lastDay = toUtcDate(localDateKey(new Date(range.end.getTime() - 1), range.timezone));
    const approvals = userIds.length
      ? await this.db.overtimeApproval.findMany({
          where: { userId: { in: userIds }, date: { gte: firstDay, lte: lastDay } },
        })
      : [];
    const approvalByKey = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) approvalByKey.set(`${a.userId}|${dateKeyOf(a.date)}`, a);

    const rows: ScheduleOvertimeRow[] = [];

    for (const [userId, personDays] of byPerson) {
      const first = personDays[0];

      let workedMin = 0;
      let scheduledMin = 0;
      let extraMin = 0;
      let daysWithExtra = 0;
      let scheduleName: string | null = null;
      let withoutSchedule = true;
      let approvedMin = 0;
      let rejectedMin = 0;
      let pendingMin = 0;
      let approvedDays = 0;
      let rejectedDays = 0;
      let pendingDays = 0;

      for (const d of personDays) {
        workedMin += d.workedMin;
        scheduledMin += d.scheduledMin;
        extraMin += d.extraMin;
        if (d.extraMin > 0) daysWithExtra += 1;
        if (d.scheduleName) {
          scheduleName = d.scheduleName;
          withoutSchedule = false;
        }

        const ap = approvalByKey.get(`${userId}|${d.date}`);
        if (ap?.status === "APPROVED") {
          approvedMin += ap.extraMin;
          approvedDays += 1;
        } else if (ap?.status === "REJECTED") {
          rejectedMin += ap.extraMin;
          rejectedDays += 1;
        } else if (d.extraMin > 0) {
          pendingMin += d.extraMin;
          pendingDays += 1;
        }
      }

      rows.push({
        userId,
        employeeName: first.employeeName,
        employeeNumber: first.employeeNumber,
        departmentId: first.departmentId,
        departmentName: first.departmentName,
        active: first.active,
        scheduleName,
        scheduledMin,
        workedMin,
        extraMin,
        missingMin: Math.max(0, scheduledMin - workedMin),
        daysWithExtra,
        withoutSchedule,
        approvedMin,
        pendingMin,
        rejectedMin,
        approvedDays,
        pendingDays,
        rejectedDays,
      });
    }

    const sorted = [...rows].sort((a, b) => b.extraMin - a.extraMin || a.employeeName.localeCompare(b.employeeName));

    const summary: ScheduleOvertimeSummary = {
      peopleTotal: sorted.length,
      peopleWithExtra: sorted.filter((r) => r.extraMin > 0).length,
      totalExtraMinutes: sorted.reduce((acc, r) => acc + r.extraMin, 0),
      totalWorkedMinutes: sorted.reduce((acc, r) => acc + r.workedMin, 0),
      totalScheduledMinutes: sorted.reduce((acc, r) => acc + r.scheduledMin, 0),
      totalApprovedMinutes: sorted.reduce((acc, r) => acc + r.approvedMin, 0),
      totalPendingMinutes: sorted.reduce((acc, r) => acc + r.pendingMin, 0),
      totalRejectedMinutes: sorted.reduce((acc, r) => acc + r.rejectedMin, 0),
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone: range.timezone, period: range.period },
    };

    return { sorted, summary };
  }
}
