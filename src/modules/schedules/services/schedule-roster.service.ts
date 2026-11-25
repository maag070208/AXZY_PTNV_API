import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { staffRoleKeys } from "@core/permissions";
import {
  assertDateKey,
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  resolveWeekStartWithConfig,
} from "@core/utils/timezone";
import type { AuditLogger } from "@modules/users/services/user.service";
import { loadScheduleAssignments, scheduleOn } from "./schedule-assignments";
import { dateKeyOf, toUtcDate, weekdayOf } from "./workday-rules";
import type { RosterCopyWeekInput, RosterQueryInput, RosterSaveInput } from "../models/dto/schedule.dto";

type SysConfigReader = (key: string) => Promise<string | null>;

const addDays = (dayKey: string, days: number) => {
  const d = toUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyOf(d);
};

/**
 * Rol semanal: turno por persona y fecha que sustituye a su horario base ese
 * día. La semana es la de nómina (misma que el reporte semanal) y no se puede
 * editar una vez cerrada la pre-nómina de esa semana.
 */
export class ScheduleRosterService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  /** Los 7 días (`YYYY-MM-DD`) de la semana de nómina que contiene `dateKey`. */
  private async weekDays(dateKey: string): Promise<string[]> {
    const key = assertDateKey(dateKey);
    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    const weekStart = await resolveWeekStartWithConfig(this.sysConfig);
    const range = resolveReportRange("WEEK", key, timezone, weekStart);
    const first = localDateKey(range.start, timezone);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }

  /** Primer día de la semana de nómina de cada fecha, sin repetir. */
  private async weekStartsOf(dates: string[]): Promise<string[]> {
    const starts = new Set<string>();
    for (const date of new Set(dates)) starts.add((await this.weekDays(date))[0]);
    return [...starts];
  }

  /** 409 si alguna de las fechas cae en una semana con la pre-nómina cerrada. */
  private async assertOpen(dates: string[]): Promise<void> {
    const starts = await this.weekStartsOf(dates);
    const closed = await this.db.payrollWeekClosure.findMany({
      where: { weekStart: { in: starts.map(toUtcDate) }, reopenedAt: null },
      select: { weekStart: true },
    });
    if (closed.length > 0) throw new HttpError(409, "PAYROLL_WEEK_CLOSED", { week: dateKeyOf(closed[0].weekStart) });
  }

  async query(input: RosterQueryInput) {
    const days = await this.weekDays(input.weekDate);
    const [closure, people] = await Promise.all([
      this.db.payrollWeekClosure.findUnique({ where: { weekStart: toUtcDate(days[0]) } }),
      this.db.user.findMany({
        where: {
          role: { in: staffRoleKeys() },
          active: true,
          employeeNumber: { not: null },
          ...(input.departmentId && { departmentId: input.departmentId }),
        },
        select: { id: true, name: true, employeeNumber: true, department: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
      }),
    ]);
    const loaded = await loadScheduleAssignments(
      this.db,
      people.map((p) => p.id),
      { start: toUtcDate(days[0]), end: toUtcDate(addDays(days[6], 1)) }
    );

    return {
      days,
      closed: closure !== null && closure.reopenedAt === null,
      people: people.map((person) => {
        let baseScheduleName: string | null = null;
        const cells = days.map((date) => {
          const entry = loaded.roster.find((r) => r.userId === person.id && dateKeyOf(r.date) === date);
          const base = scheduleOn({ assignments: loaded.assignments, roster: [] }, person.id, date);
          baseScheduleName = base?.name ?? baseScheduleName;
          const schedule = entry ? entry.schedule : base;
          if (entry?.restDay || !schedule) {
            // Descanso del rol, o sin horario base (NONE).
            return {
              date,
              source: entry ? ("ROSTER" as const) : ("NONE" as const),
              scheduleId: null,
              scheduleName: null,
              restDay: Boolean(entry),
              startTime: null,
              endTime: null,
            };
          }
          const day = schedule.days.find((d) => d.weekday === weekdayOf(date));
          const rest = !day || day.restDay;
          return {
            date,
            source: entry ? ("ROSTER" as const) : ("BASE" as const),
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            restDay: rest,
            startTime: rest ? null : day.startTime,
            endTime: rest ? null : day.endTime,
          };
        });
        return {
          userId: person.id,
          employeeNumber: person.employeeNumber as string,
          name: person.name,
          departmentId: person.department?.id ?? null,
          departmentName: person.department?.name ?? null,
          baseScheduleName,
          cells,
        };
      }),
    };
  }

  async save(actorId: string | undefined, input: RosterSaveInput) {
    // Una sola instrucción por (persona, fecha): gana la última.
    const byKey = new Map<string, RosterSaveInput["entries"][number]>();
    for (const entry of input.entries) {
      assertDateKey(entry.date);
      const chosen = [Boolean(entry.scheduleId), entry.restDay === true, entry.clear === true].filter(Boolean).length;
      if (chosen !== 1) throw new HttpError(400, "ROSTER_ENTRY_INVALID", { userId: entry.userId, date: entry.date });
      byKey.set(`${entry.userId}|${entry.date}`, entry);
    }
    const entries = [...byKey.values()];

    await this.assertOpen(entries.map((e) => e.date));

    const scheduleIds = [...new Set(entries.flatMap((e) => (e.scheduleId ? [e.scheduleId] : [])))];
    const userIds = [...new Set(entries.map((e) => e.userId))];
    const [schedules, users] = await Promise.all([
      this.db.schedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true, active: true } }),
      this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
    ]);
    if (users.length !== userIds.length) throw new HttpError(404, "USER_NOT_FOUND");
    if (schedules.length !== scheduleIds.length) throw new HttpError(404, "SCHEDULE_NOT_FOUND");
    if (schedules.some((s) => !s.active)) throw new HttpError(400, "INVALID_SCHEDULE");

    let saved = 0;
    let cleared = 0;
    await this.db.$transaction(async (tx) => {
      for (const entry of entries) {
        const where = { userId_date: { userId: entry.userId, date: toUtcDate(entry.date) } };
        if (entry.clear) {
          const { count } = await tx.scheduleRosterEntry.deleteMany({
            where: { userId: entry.userId, date: toUtcDate(entry.date) },
          });
          cleared += count;
          continue;
        }
        const data = entry.scheduleId
          ? { scheduleId: entry.scheduleId, restDay: false }
          : { scheduleId: null, restDay: true };
        await tx.scheduleRosterEntry.upsert({
          where,
          create: { userId: entry.userId, date: toUtcDate(entry.date), ...data, createdById: actorId ?? null },
          update: { ...data, createdById: actorId ?? null },
        });
        saved += 1;
      }
    });

    await this.audit?.({
      action: "SCHEDULE_ROSTER_UPDATED",
      entityType: "ScheduleRosterEntry",
      entityId: entries[0]?.date ?? "",
      userId: actorId,
      newState: { saved, cleared },
    });
    return { saved, cleared };
  }

  /** Copia el rol de una semana a otra por posición del día (la de destino se sobrescribe). */
  async copyWeek(actorId: string | undefined, input: RosterCopyWeekInput) {
    const from = await this.weekDays(input.fromWeekDate);
    const to = await this.weekDays(input.toWeekDate);
    await this.assertOpen(to);

    const sourceRows = await this.db.scheduleRosterEntry.findMany({
      where: {
        date: { gte: toUtcDate(from[0]), lte: toUtcDate(from[6]) },
        ...(input.userIds && { userId: { in: input.userIds } }),
      },
    });
    // Sin `userIds`, se sobrescriben las personas que tienen rol en la semana origen.
    const userIds = input.userIds ?? [...new Set(sourceRows.map((r) => r.userId))];

    const rows = sourceRows.map((r) => ({
      userId: r.userId,
      date: toUtcDate(to[from.indexOf(dateKeyOf(r.date))]),
      scheduleId: r.scheduleId,
      restDay: r.restDay,
      createdById: actorId ?? null,
    }));
    await this.db.$transaction([
      this.db.scheduleRosterEntry.deleteMany({
        where: { userId: { in: userIds }, date: { gte: toUtcDate(to[0]), lte: toUtcDate(to[6]) } },
      }),
      this.db.scheduleRosterEntry.createMany({ data: rows }),
    ]);

    await this.audit?.({
      action: "SCHEDULE_ROSTER_COPIED",
      entityType: "ScheduleRosterEntry",
      entityId: to[0],
      userId: actorId,
      newState: { from: from[0], to: to[0], copied: rows.length },
    });
    return { copied: rows.length };
  }
}
