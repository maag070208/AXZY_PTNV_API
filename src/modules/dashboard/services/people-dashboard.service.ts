import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { localDateKey, resolveTimezoneWithConfig } from "@core/utils/timezone";
import { scopeOf, staffRoleKeys, type UserPermissions } from "@core/permissions";
import type { EmployeeRecordsService } from "@modules/hr";
import type { WeeklyAttendanceService } from "@modules/schedules/services/weekly-attendance.service";

type SysConfigReader = (key: string) => Promise<string | null>;

const personalRoles = (): string[] => staffRoleKeys();
const UPCOMING_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Estado de una persona hoy:
 * - `PRESENT` checó a tiempo · `LATE` checó con retardo
 * - `NOT_ARRIVED` ya pasó su hora de entrada y no ha checado (falta, si no llega)
 * - `NOT_YET` todavía no es su hora de entrada
 * - `REST` descanso · `NO_SCHEDULE` sin horario y sin checar
 * - `UNLINKED` sin vínculo al reloj (no hay forma de saber)
 */
export type TodayStatus = "PRESENT" | "LATE" | "NOT_ARRIVED" | "NOT_YET" | "REST" | "NO_SCHEDULE" | "UNLINKED";

export interface TodayRow {
  userId: string;
  name: string;
  employeeNumber: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: TodayStatus;
  onSite: boolean;
  entryAt: string | null;
  exitAt: string | null;
  lateMin: number;
  shift: string | null;
  scheduledStartAt: string | null;
}

const monthDay = (d: Date) => d.toISOString().slice(5, 10);

/**
 * Tableros de personal (RH, gerencia, jefes de área, empleado): expedientes,
 * plantilla, asistencia de hoy, horas extra de la semana y pendientes de
 * configuración. Cada método lo expone un endpoint con su propio permiso; el
 * alcance del permiso (propio / área / todo) recorta los datos aquí.
 */
export class PeopleDashboardService {
  constructor(
    private readonly records: EmployeeRecordsService,
    private readonly weeklyAttendance: WeeklyAttendanceService,
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader
  ) {}

  private async today() {
    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    return { timezone, date: localDateKey(new Date(), timezone) };
  }

  /** Expedientes incompletos (documentos obligatorios, otros documentos y datos personales). */
  hrRecords() {
    return this.records.gaps();
  }

  /** Plantilla: activos, altas y bajas del mes, cumpleaños y aniversarios de los próximos días. */
  async people(actor: UserPermissions) {
    const { timezone, date } = await this.today();
    const monthStart = new Date(`${date.slice(0, 8)}01T00:00:00.000Z`);
    const nextMonth = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const withDisciplinary = scopeOf(actor, "hr.disciplinary_reports") !== "NONE";

    const [active, hires, departures, people, disciplinary] = await Promise.all([
      this.db.user.count({ where: { role: { in: personalRoles() }, active: true } }),
      this.db.user.count({ where: { role: { in: personalRoles() }, hireDate: { gte: monthStart, lt: nextMonth } } }),
      this.db.user.count({ where: { role: { in: personalRoles() }, deactivatedAt: { gte: monthStart, lt: nextMonth } } }),
      this.db.user.findMany({
        where: { role: { in: personalRoles() }, active: true, OR: [{ birthDate: { not: null } }, { hireDate: { not: null } }] },
        select: { id: true, name: true, birthDate: true, hireDate: true, department: { select: { name: true } } },
      }),
      withDisciplinary
        ? this.db.disciplinaryReport.findMany({
            where: { incidentDate: { gte: monthStart, lt: nextMonth } },
            orderBy: { incidentDate: "desc" },
            select: { id: true, reason: true, incidentDate: true, user: { select: { id: true, name: true } } },
          })
        : Promise.resolve(null),
    ]);

    // Próximos días (hoy incluido) como "MM-DD" → fecha, para cumpleaños y aniversarios.
    const upcoming = new Map<string, string>();
    for (let i = 0; i < UPCOMING_DAYS; i++) {
      const d = new Date(Date.parse(`${date}T12:00:00.000Z`) + i * MS_PER_DAY);
      upcoming.set(monthDay(d), d.toISOString().slice(0, 10));
    }
    const year = Number(date.slice(0, 4));
    const birthdays = people
      .filter((p) => p.birthDate && upcoming.has(monthDay(p.birthDate)))
      .map((p) => ({ userId: p.id, name: p.name, departmentName: p.department?.name ?? null, date: upcoming.get(monthDay(p.birthDate!))! }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const anniversaries = people
      .filter((p) => p.hireDate && upcoming.has(monthDay(p.hireDate)) && year - p.hireDate.getUTCFullYear() >= 1)
      .map((p) => ({
        userId: p.id,
        name: p.name,
        departmentName: p.department?.name ?? null,
        date: upcoming.get(monthDay(p.hireDate!))!,
        years: year - p.hireDate!.getUTCFullYear(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      date,
      timezone,
      active,
      hiresThisMonth: hires,
      departuresThisMonth: departures,
      birthdays,
      anniversaries,
      disciplinaryThisMonth: disciplinary
        ? {
            count: disciplinary.length,
            latest: disciplinary.slice(0, 5).map((r) => ({
              id: r.id,
              reason: r.reason,
              date: r.incidentDate.toISOString().slice(0, 10),
              userId: r.user.id,
              name: r.user.name,
            })),
          }
        : null,
    };
  }

  /**
   * Asistencia de hoy con el mismo cálculo del reporte semanal (Pre nómina):
   * quién checó, con retardo, quién no ha llegado y quién está en sitio.
   * Alcance de `attendance.view`: todo / su departamento / solo él.
   */
  async attendanceToday(actor: UserPermissions) {
    const { date, timezone } = await this.today();
    const scope = scopeOf(actor, "attendance.view");
    const ownOnly = scope === "OWN" || (scope === "AREA" && !actor.departmentId);
    const departmentId = scope === "ALL" ? undefined : actor.departmentId ?? undefined;
    const report = await this.weeklyAttendance.report({ date, departmentId });
    const now = Date.now();

    const rows: TodayRow[] = report.rows
      .filter((r) => !ownOnly || r.userId === actor.id)
      .map((r) => {
        const day = r.days.find((d) => d.date === date);
        const sessions = day?.sessions ?? [];
        const last = sessions[sessions.length - 1];
        let status: TodayStatus;
        if (!r.linked) status = "UNLINKED";
        else if (sessions.length > 0) status = (day?.lateMin ?? 0) > 0 ? "LATE" : "PRESENT";
        else if (day?.status === "REST") status = "REST";
        else if (!day?.scheduledStartAt) status = "NO_SCHEDULE";
        else status = Date.parse(day.scheduledStartAt) < now ? "NOT_ARRIVED" : "NOT_YET";
        return {
          userId: r.userId,
          name: r.name,
          employeeNumber: r.employeeNumber,
          departmentId: r.departmentId,
          departmentName: r.departmentName,
          status,
          onSite: !!last && last.entryAt !== null && last.exitAt === null,
          entryAt: day?.entryAt ?? null,
          exitAt: day?.exitAt ?? null,
          lateMin: day?.lateMin ?? 0,
          shift: day?.shift ?? null,
          scheduledStartAt: day?.scheduledStartAt ?? null,
        };
      });

    const counts = Object.fromEntries(
      (["PRESENT", "LATE", "NOT_ARRIVED", "NOT_YET", "REST", "NO_SCHEDULE", "UNLINKED"] as TodayStatus[]).map((s) => [
        s,
        rows.filter((r) => r.status === s).length,
      ])
    ) as Record<TodayStatus, number>;

    return {
      date,
      timezone,
      scope,
      counts: { ...counts, onSite: rows.filter((r) => r.onSite).length, people: rows.length },
      rows,
    };
  }

  /** Horas extra de la semana en curso: calculadas, aprobadas y no aprobadas, y quién tiene más pendiente. */
  async overtimeWeek() {
    const { date } = await this.today();
    const report = await this.weeklyAttendance.report({ date });
    const { summary } = report;
    return {
      range: report.range,
      extraMin: summary.extraMin,
      approvedExtraMin: summary.approvedExtraMin,
      pendingExtraMin: summary.pendingExtraMin,
      rejectedExtraMin: summary.rejectedExtraMin,
      topPending: report.rows
        .filter((r) => r.totals.pendingExtraMin > 0)
        .sort((a, b) => b.totals.pendingExtraMin - a.totals.pendingExtraMin)
        .slice(0, 8)
        .map((r) => ({ userId: r.userId, name: r.name, departmentName: r.departmentName, pendingExtraMin: r.totals.pendingExtraMin })),
    };
  }

  /** Lo que impide calcular bien la asistencia: checadas sin vínculo, personal sin reloj o sin horario. */
  async setupGaps() {
    const { date } = await this.today();
    const today = new Date(`${date}T00:00:00.000Z`);
    const since = new Date(today.getTime() - 30 * MS_PER_DAY);
    const [clockNumbers, linked, withoutClock, withoutSchedule] = await Promise.all([
      this.db.timeClockPunch.findMany({ where: { occurredAt: { gte: since } }, distinct: ["employeeNumber"], select: { employeeNumber: true } }),
      this.db.timeClockEmployee.findMany({ select: { employeeNumber: true } }),
      this.db.user.count({ where: { role: { in: personalRoles() }, active: true, timeClockEmployees: { none: {} } } }),
      this.db.user.count({
        where: {
          role: { in: personalRoles() },
          active: true,
          scheduleAssignments: { none: { validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] } },
        },
      }),
    ]);
    const linkedSet = new Set(linked.map((l) => l.employeeNumber));
    return {
      unlinkedClockNumbers: clockNumbers.filter((c) => !linkedSet.has(c.employeeNumber)).length,
      personalWithoutClock: withoutClock,
      personalWithoutSchedule: withoutSchedule,
    };
  }
}
