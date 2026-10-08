import { startOfLocalDay } from "@core/utils/timezone";

/**
 * Regla única del cálculo de una jornada (horas programadas, tiempo extra y
 * faltante) a partir de las sesiones del reloj de un día. La usan las horas
 * extra (`ScheduleService.computeOvertimeDays`, lo que aprueban los jefes) y el
 * reporte semanal de asistencia, así que los dos muestran el mismo número.
 */

const MS_PER_MINUTE = 60 * 1000;

/** Jornada que se supone para quien no tiene horario asignado. */
export const DEFAULT_WORKDAY_MIN = 8 * 60;
/** Mínimo de tiempo extra que cuenta sin horario (el default de `Schedule.minOvertimeMin`). */
export const DEFAULT_MIN_OVERTIME_MIN = 60;

/** "HH:mm" → minutos desde medianoche. */
export const toMinutes = (hhmm: string | null): number => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Día de la semana 1..7 (1=Lunes) de una clave `YYYY-MM-DD`. */
export const weekdayOf = (dayKey: string): number => {
  const js = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0=Dom
  return js === 0 ? 7 : js;
};

/** Día local `YYYY-MM-DD` como instante UTC-medianoche (mismo criterio que `ScheduleAssignment.validFrom`). */
export const toUtcDate = (dayKey: string): Date => new Date(`${dayKey}T00:00:00.000Z`);

/** Clave `YYYY-MM-DD` de una fecha guardada como UTC-medianoche. */
export const dateKeyOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Minutos de un tramo; si `to` es menor, el tramo cruza la medianoche. */
export const minutesBetween = (from: string | null, to: string | null): number => {
  if (!from || !to) return 0;
  const diff = toMinutes(to) - toMinutes(from);
  return diff > 0 ? diff : diff + 24 * 60;
};

export interface WorkdaySchedule {
  name: string;
  entryToleranceMin: number;
  exitToleranceMin: number;
  mealBreakMin: number;
  minOvertimeMin: number;
  crossesMidnight: boolean;
  days: Array<{
    weekday: number;
    startTime: string | null;
    endTime: string | null;
    splitStartTime: string | null;
    splitEndTime: string | null;
    restDay: boolean;
  }>;
}

/** Entrada programada del día como instante (null en descanso o sin horario). */
export const scheduledStartAt = (schedule: WorkdaySchedule | null, dayKey: string, timezone: string): Date | null => {
  const day = schedule?.days.find((d) => d.weekday === weekdayOf(dayKey));
  if (!day || day.restDay || !day.startTime) return null;
  return new Date(startOfLocalDay(dayKey, timezone).getTime() + toMinutes(day.startTime) * MS_PER_MINUTE);
};

/** Lo que el cálculo necesita de una sesión del reloj (entrada/salida emparejadas). */
export interface WorkdaySession {
  entryAt?: string | null;
  exitAt: string | null;
  workedMinutes: number;
}

export interface Workday {
  workedMin: number;
  /** Jornada programada (0 en descanso; `DEFAULT_WORKDAY_MIN` sin horario). */
  scheduledMin: number;
  extraMin: number;
  /** Lo que faltó para cubrir la jornada, si trabajó (0 si no checó). */
  missingMin: number;
  /** Retardo: minutos después de la entrada programada, si pasó la tolerancia (0 si llegó a tiempo). */
  lateMin: number;
  restDay: boolean;
  scheduleName: string | null;
  withoutSchedule: boolean;
}

/**
 * Tiempo extra de un día:
 * - Día laboral: lo trabajado DESPUÉS de la salida programada (último tramo),
 *   menos la tolerancia de salida, si alcanza el mínimo del horario.
 * - Descanso: todo lo trabajado, si alcanza el mínimo.
 * - Sin horario: no genera tiempo extra (SCHEDULES.md §6).
 *
 * Retardo (`lateMin`): primera entrada después de la entrada programada del
 * primer tramo, cuando supera la tolerancia de entrada del horario.
 */
export const computeWorkday = (
  dayKey: string,
  sessions: WorkdaySession[],
  schedule: WorkdaySchedule | null,
  timezone: string
): Workday => {
  const workedMin = sessions.reduce((acc, s) => acc + s.workedMinutes, 0);

  if (!schedule) {
    // Sin horario no hay con qué comparar: NO se genera tiempo extra (el día se
    // marca `withoutSchedule`). Ver SCHEDULES.md §6.
    const over = workedMin - DEFAULT_WORKDAY_MIN;
    return {
      workedMin,
      scheduledMin: DEFAULT_WORKDAY_MIN,
      extraMin: 0,
      missingMin: workedMin > 0 ? Math.max(0, -over) : 0,
      lateMin: 0,
      restDay: false,
      scheduleName: null,
      withoutSchedule: true,
    };
  }

  const day = schedule.days.find((d) => d.weekday === weekdayOf(dayKey));
  if (!day || day.restDay) {
    return {
      workedMin,
      scheduledMin: 0,
      extraMin: workedMin > 0 && workedMin >= schedule.minOvertimeMin ? workedMin : 0,
      missingMin: 0,
      lateMin: 0,
      restDay: true,
      scheduleName: schedule.name,
      withoutSchedule: false,
    };
  }

  const scheduledMin = Math.max(
    0,
    minutesBetween(day.startTime, day.endTime) +
      (day.splitStartTime && day.splitEndTime ? minutesBetween(day.splitStartTime, day.splitEndTime) : 0) -
      schedule.mealBreakMin
  );

  const dayStartMs = startOfLocalDay(dayKey, timezone).getTime();

  // Retardo: primera entrada contra la entrada programada (primer tramo) + tolerancia.
  let lateMin = 0;
  const firstEntry = sessions
    .map((s) => (s.entryAt ? new Date(s.entryAt).getTime() : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  if (day.startTime && Number.isFinite(firstEntry)) {
    const late = Math.round((firstEntry - (dayStartMs + toMinutes(day.startTime) * MS_PER_MINUTE)) / MS_PER_MINUTE);
    if (late > schedule.entryToleranceMin) lateMin = late;
  }

  let extraMin = 0;
  // Salida programada (último tramo) como instante local.
  const scheduledEnd = day.splitEndTime ?? day.endTime;
  if (scheduledEnd) {
    const crosses = schedule.crossesMidnight || toMinutes(scheduledEnd) <= toMinutes(day.startTime);
    const exitMs = dayStartMs + (toMinutes(scheduledEnd) + (crosses ? 24 * 60 : 0)) * MS_PER_MINUTE;
    const lastExit = sessions
      .map((s) => (s.exitAt ? new Date(s.exitAt).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    if (lastExit > 0) {
      const afterExit = Math.round((lastExit - exitMs) / MS_PER_MINUTE);
      const dayExtra = Math.max(0, afterExit - schedule.exitToleranceMin);
      if (dayExtra > 0 && dayExtra >= schedule.minOvertimeMin) extraMin = dayExtra;
    }
  }

  return {
    workedMin,
    scheduledMin,
    extraMin,
    missingMin: workedMin > 0 ? Math.max(0, scheduledMin - workedMin) : 0,
    lateMin,
    restDay: false,
    scheduleName: schedule.name,
    withoutSchedule: false,
  };
};
