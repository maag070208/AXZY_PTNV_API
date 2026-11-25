import type { Prisma, PrismaClient } from "@prisma/client";
import { toUtcDate, weekdayOf, type WorkdaySchedule } from "./workday-rules";

const withSchedule = { schedule: { include: { days: true } } } as const;

export type LoadedAssignment = Prisma.ScheduleAssignmentGetPayload<{ include: typeof withSchedule }>;
export type LoadedRosterEntry = Prisma.ScheduleRosterEntryGetPayload<{ include: typeof withSchedule }>;

/** Lo cargado para el periodo: horarios base + rol semanal (que los sustituye por día). */
export interface LoadedSchedules {
  assignments: LoadedAssignment[];
  roster: LoadedRosterEntry[];
}

/** Horario resuelto de un día: el real o el sintetizado de un descanso del rol. */
export type ResolvedSchedule = WorkdaySchedule & { id: string | null };

/** Tolerancias por defecto (las del esquema de `Schedule`) cuando el descanso no tiene horario base. */
const REST_DEFAULTS = { entryToleranceMin: 10, exitToleranceMin: 10, mealBreakMin: 0, minOvertimeMin: 60 };

/**
 * Asignaciones de horario (con sus días) y entradas del rol semanal que tocan
 * `[start, end)` para las personas dadas. Una consulta por tabla para el
 * periodo; el horario de cada día lo resuelve `scheduleOn`.
 */
export const loadScheduleAssignments = async (
  db: PrismaClient,
  userIds: string[],
  range: { start: Date; end: Date }
): Promise<LoadedSchedules> => {
  if (userIds.length === 0) return { assignments: [], roster: [] };
  const [assignments, roster] = await Promise.all([
    db.scheduleAssignment.findMany({
      where: {
        userId: { in: userIds },
        validFrom: { lt: range.end },
        OR: [{ validTo: null }, { validTo: { gte: range.start } }],
      },
      include: withSchedule,
      orderBy: { validFrom: "asc" },
    }),
    db.scheduleRosterEntry.findMany({
      where: { userId: { in: userIds }, date: { gte: range.start, lt: range.end } },
      include: withSchedule,
    }),
  ]);
  return { assignments, roster };
};

/**
 * Horario de la persona en el día local `dayKey`. Prioridad:
 * 1. Rol semanal con turno: ese horario.
 * 2. Rol semanal con descanso: el horario base (o los valores por defecto) con ese día forzado a descanso.
 * 3. Sin entrada de rol: el horario base vigente (`validFrom`/`validTo` son UTC-medianoche
 *    del día; con vigencias encimadas gana la más antigua).
 * `null` = sin horario ese día.
 */
export const scheduleOn = (
  loaded: LoadedSchedules,
  userId: string,
  dayKey: string
): ResolvedSchedule | null => {
  const dayMs = toUtcDate(dayKey).getTime();
  const base =
    loaded.assignments.find(
      (a) => a.userId === userId && a.validFrom.getTime() <= dayMs && (!a.validTo || a.validTo.getTime() >= dayMs)
    )?.schedule ?? null;

  const entry = loaded.roster.find((r) => r.userId === userId && r.date.getTime() === dayMs);
  if (!entry) return base;
  if (entry.schedule && !entry.restDay) return entry.schedule;

  return {
    id: base?.id ?? null,
    name: base?.name ?? "Descanso",
    entryToleranceMin: base?.entryToleranceMin ?? REST_DEFAULTS.entryToleranceMin,
    exitToleranceMin: base?.exitToleranceMin ?? REST_DEFAULTS.exitToleranceMin,
    mealBreakMin: base?.mealBreakMin ?? REST_DEFAULTS.mealBreakMin,
    minOvertimeMin: base?.minOvertimeMin ?? REST_DEFAULTS.minOvertimeMin,
    crossesMidnight: false,
    days: [
      {
        weekday: weekdayOf(dayKey),
        restDay: true,
        startTime: null,
        endTime: null,
        splitStartTime: null,
        splitEndTime: null,
      },
    ],
  };
};
