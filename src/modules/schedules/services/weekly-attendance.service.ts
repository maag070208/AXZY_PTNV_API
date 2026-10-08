import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { staffRoleKeys } from "@core/permissions";
import {
  assertDateKey,
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  resolveWeekStartWithConfig,
} from "@core/utils/timezone";
import { TimeClockReportService } from "@modules/time-clock/services/time-clock-report.service";
import { loadScheduleAssignments, scheduleOn } from "./schedule-assignments";
import { computeWorkday, dateKeyOf, scheduledStartAt, shiftOf, toUtcDate } from "./workday-rules";
import type {
  WeeklyAttendanceDay,
  WeeklyAttendanceDayStatus,
  WeeklyAttendanceReport,
  WeeklyAttendanceRow,
  WeeklyAttendanceTotals,
} from "../models/entity/schedule.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/** Roles con expediente de personal (los que checan y cobran tiempo extra). */
const personalRoles = (): string[] => staffRoleKeys();

/** Incidencias que dejan el día incompleto (la entrada abierta de hoy es "en sitio", no incompleta). */
const INCOMPLETE_INCIDENTS = new Set(["ENTRY_WITHOUT_EXIT", "EXIT_WITHOUT_ENTRY"]);

export interface WeeklyAttendanceParams {
  /** Cualquier día de la semana a consultar (`YYYY-MM-DD`). */
  date: string;
  departmentId?: string;
  /** Busca por nombre, número de empleado o número del reloj. */
  q?: string;
}

const addDays = (dayKey: string, days: number) => {
  const d = toUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyOf(d);
};

const emptyTotals = (): WeeklyAttendanceTotals => ({
  workedMin: 0,
  scheduledMin: 0,
  extraMin: 0,
  approvedExtraMin: 0,
  pendingExtraMin: 0,
  rejectedExtraMin: 0,
  missingMin: 0,
  absences: 0,
  incompleteDays: 0,
});

/**
 * Reporte semanal de asistencia (el control que RH llevaba en Excel): por
 * persona de un departamento, los 7 días con entrada, salida, horas trabajadas,
 * tiempo extra y faltas, más el total de la semana contra lo aprobado.
 *
 * - Fuente: checadas de los relojes de asistencia (mismo emparejamiento que
 *   entradas/salidas); solo cuentan las personas vinculadas al reloj.
 * - Tiempo extra: la regla de `computeWorkday`, la misma que aprueban los jefes.
 *   Se muestra SIEMPRE lo calculado, con su decisión (aprobado, rechazado o
 *   pendiente = no aprobado).
 * - Universo: el personal del departamento (activo, o con checadas en la
 *   semana), aunque no haya checado: así se ven las faltas.
 */
export class WeeklyAttendanceService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly timeClockReport: TimeClockReportService = new TimeClockReportService(prismaClient),
    private readonly sysConfig?: SysConfigReader
  ) {}

  async report(params: WeeklyAttendanceParams): Promise<WeeklyAttendanceReport> {
    const dateKey = assertDateKey(params.date, "INVALID_REPORT_DATE");
    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    const weekStart = await resolveWeekStartWithConfig(this.sysConfig);
    const range = resolveReportRange("WEEK", dateKey, timezone, weekStart);
    const firstDay = localDateKey(range.start, timezone);
    const days = Array.from({ length: 7 }, (_, i) => addDays(firstDay, i));
    const today = localDateKey(new Date(), timezone);

    // Sesiones del reloj de la semana (una fila por sesión), por persona y día.
    const sessions = (
      await this.timeClockReport.reportExport({
        page: 1,
        limit: 100000,
        filters: {
          period: "WEEK",
          date: dateKey,
          includeInactive: true,
          ...(params.departmentId && { departmentId: params.departmentId }),
        },
        sort: undefined,
      })
    ).data.filter((s) => s.linked === true);
    const sessionsByKey = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = `${s.employeeId}|${s.date}`;
      sessionsByKey.set(key, [...(sessionsByKey.get(key) ?? []), s]);
    }
    const withSessions = [...new Set(sessions.map((s) => s.employeeId))];

    const people = await this.db.user.findMany({
      where: {
        role: { in: personalRoles() },
        ...(params.departmentId && { departmentId: params.departmentId }),
        OR: [{ active: true }, { id: { in: withSessions } }],
      },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        jobTitle: true,
        active: true,
        department: { select: { id: true, name: true } },
        timeClockEmployees: { select: { employeeNumber: true } },
      },
      orderBy: { name: "asc" },
    });
    const userIds = people.map((p) => p.id);

    const [assignments, approvals] = await Promise.all([
      loadScheduleAssignments(this.db, userIds, range),
      this.db.overtimeApproval.findMany({
        where: { userId: { in: userIds }, date: { gte: toUtcDate(days[0]), lte: toUtcDate(days[6]) } },
      }),
    ]);
    const approvalByKey = new Map(approvals.map((a) => [`${a.userId}|${dateKeyOf(a.date)}`, a]));

    const rows: WeeklyAttendanceRow[] = people.map((person) => {
      const clockNumbers = person.timeClockEmployees.map((t) => t.employeeNumber);
      const linked = clockNumbers.length > 0;
      const totals = emptyTotals();
      let scheduleName: string | null = null;

      const personDays = days.map((dayKey): WeeklyAttendanceDay => {
        const schedule = scheduleOn(assignments, person.id, dayKey);
        scheduleName = schedule?.name ?? scheduleName;
        const daySessions = sessionsByKey.get(`${person.id}|${dayKey}`) ?? [];
        const workday = computeWorkday(dayKey, daySessions, schedule, timezone);
        const incomplete = daySessions.some((s) => s.incident !== null && INCOMPLETE_INCIDENTS.has(s.incident));

        let status: WeeklyAttendanceDayStatus;
        if (dayKey > today) status = "FUTURE";
        else if (!linked) status = "NO_INFO";
        else if (daySessions.length > 0) {
          status = incomplete ? "INCOMPLETE" : workday.restDay ? "REST_WORKED" : workday.extraMin > 0 ? "OVERTIME" : "WORKED";
        } else if (workday.restDay) status = "REST";
        // Hoy sin checadas todavía, o sin horario (no se sabe si le tocaba): sin información.
        else if (dayKey === today || workday.withoutSchedule) status = "NO_INFO";
        else status = "ABSENCE";

        const decision = approvalByKey.get(`${person.id}|${dayKey}`);
        const approval = decision ? decision.status : workday.extraMin > 0 ? "PENDING" : null;
        const approvedExtraMin = decision?.status === "APPROVED" ? decision.extraMin : 0;

        const counts = status !== "FUTURE" && status !== "NO_INFO";
        if (counts) {
          totals.workedMin += workday.workedMin;
          totals.scheduledMin += workday.scheduledMin;
          totals.extraMin += workday.extraMin;
          totals.missingMin += workday.missingMin;
        }
        totals.approvedExtraMin += approvedExtraMin;
        if (approval === "PENDING") totals.pendingExtraMin += workday.extraMin;
        if (approval === "REJECTED") totals.rejectedExtraMin += workday.extraMin;
        if (status === "ABSENCE") totals.absences += 1;
        if (status === "INCOMPLETE") totals.incompleteDays += 1;

        const entries = daySessions.map((s) => s.entryAt).filter((v): v is string => v !== null).sort();
        const exits = daySessions.map((s) => s.exitAt).filter((v): v is string => v !== null).sort();
        return {
          date: dayKey,
          status,
          entryAt: entries[0] ?? null,
          exitAt: exits[exits.length - 1] ?? null,
          sessions: daySessions.map((s) => ({
            entryAt: s.entryAt,
            exitAt: s.exitAt,
            workedMinutes: s.workedMinutes,
            incident: s.incident,
          })),
          workedMin: workday.workedMin,
          scheduledMin: workday.scheduledMin,
          extraMin: workday.extraMin,
          missingMin: workday.missingMin,
          lateMin: workday.lateMin,
          shift: shiftOf(schedule, dayKey),
          scheduledStartAt: scheduledStartAt(schedule, dayKey, timezone)?.toISOString() ?? null,
          approval,
          approvedExtraMin,
        };
      });

      return {
        userId: person.id,
        employeeNumber: person.employeeNumber,
        clockNumbers,
        name: person.name,
        jobTitle: person.jobTitle,
        departmentId: person.department?.id ?? null,
        departmentName: person.department?.name ?? null,
        active: person.active,
        linked,
        scheduleName,
        withoutSchedule: scheduleName === null,
        days: personDays,
        totals,
      };
    });

    const q = params.q?.trim().toLowerCase();
    const visible = q
      ? rows.filter((r) =>
          [r.name, r.employeeNumber, ...r.clockNumbers].some((v) => (v ?? "").toLowerCase().includes(q))
        )
      : rows;

    const summary = { ...emptyTotals(), people: visible.length, unlinked: 0, withoutSchedule: 0 };
    for (const r of visible) {
      for (const key of Object.keys(r.totals) as Array<keyof WeeklyAttendanceTotals>) summary[key] += r.totals[key];
      if (!r.linked) summary.unlinked += 1;
      if (r.withoutSchedule) summary.withoutSchedule += 1;
    }

    return {
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone, days },
      rows: visible,
      summary,
    };
  }
}
