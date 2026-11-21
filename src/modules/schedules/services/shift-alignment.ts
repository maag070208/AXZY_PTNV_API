import { localDateKey, startOfLocalDay } from "@core/utils/timezone";
import { buildTimeline, type Jornada } from "@modules/time-clock/services/time-clock-timeline";
import { dateKeyOf, toMinutes, toUtcDate, weekdayOf, type WorkdaySchedule } from "./workday-rules";

/**
 * Alinea las sesiones del reloj al horario de la persona. El reloj no dice si
 * una checada es entrada o salida: `buildTimeline` toma la primera como entrada
 * y absorbe todo lo que caiga en 13 h. Eso se rompe cuando alguien olvida
 * checar la entrada y solo checa la salida al terminar su turno (la salida de
 * las 19:00 se vería como entrada y se fusionaría con la entrada de la mañana
 * siguiente). Aquí cada checada se asigna al turno cuyo borde (inicio o fin)
 * le queda más cerca:
 * - Checada sola (o primera de una sesión) cerca de un FIN de turno, con el
 *   resto de las checadas en otro turno → salida sin entrada del día de ese turno.
 * - Entrada sola ya pasado el fin del turno → entrada sin salida, no en sitio.
 * Sin horario en D-1/D no se toca nada. El módulo del reloj no conoce horarios:
 * esto vive en `schedules` y lo llaman los consumidores por persona.
 */

const MS_PER_MINUTE = 60 * 1000;
/** Margen tras el fin del turno (+ tolerancia de salida) antes de dar por perdida la salida. */
const OPEN_ENTRY_MARGIN_MIN = 60;

/** Lo que la alineación necesita (y conserva) de una sesión; las filas del reporte lo cumplen. */
export interface AlignableSession {
  id: string;
  /** Día local al que se atribuye; en salidas sin entrada es el día del turno. */
  date: string;
  entryAt: string | null;
  exitAt: string | null;
  workedMinutes: number;
  incident: "ENTRY_WITHOUT_EXIT" | "EXIT_WITHOUT_ENTRY" | "OPEN_ENTRY" | null;
  crossesMidnight: boolean;
  punches?: string[];
  outings?: { exitAt: string; returnAt: string | null }[];
  awayMinutes?: number;
  incompleteSequence?: boolean;
  onSite?: boolean;
}

interface Boundary {
  shiftDay: string;
  kind: "START" | "END";
  at: number;
  shiftEnd: number;
  exitToleranceMin: number;
}

const addDays = (dayKey: string, days: number): string => {
  const d = toUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyOf(d);
};

/** Inicio y fin (instantes) del turno laborable de `dayKey`; null en descanso o sin horario. */
const shiftWindow = (schedule: WorkdaySchedule | null, dayKey: string, timezone: string) => {
  const day = schedule?.days.find((d) => d.weekday === weekdayOf(dayKey));
  if (!schedule || !day || day.restDay || !day.startTime) return null;
  const endTime = day.splitEndTime ?? day.endTime;
  if (!endTime) return null;
  const dayStart = startOfLocalDay(dayKey, timezone).getTime();
  const crosses = schedule.crossesMidnight || toMinutes(endTime) <= toMinutes(day.startTime);
  return {
    start: dayStart + toMinutes(day.startTime) * MS_PER_MINUTE,
    end: dayStart + (toMinutes(endTime) + (crosses ? 24 * 60 : 0)) * MS_PER_MINUTE,
    exitToleranceMin: schedule.exitToleranceMin,
  };
};

const toSession = <T extends AlignableSession>(
  template: T,
  j: Jornada,
  timezone: string,
  over: Partial<AlignableSession>
): T => {
  const { entryAt, exitAt } = j;
  return {
    ...template,
    id: `${template.id}#${entryAt.getTime()}`,
    date: localDateKey(entryAt, timezone),
    entryAt: entryAt.toISOString(),
    exitAt: exitAt?.toISOString() ?? null,
    workedMinutes: exitAt ? Math.round((exitAt.getTime() - entryAt.getTime()) / MS_PER_MINUTE) : 0,
    incident: j.incident,
    crossesMidnight: Boolean(exitAt && localDateKey(entryAt, timezone) !== localDateKey(exitAt, timezone)),
    punches: j.punches.map((p) => p.toISOString()),
    outings: j.outings.map((o) => ({ exitAt: o.exitAt.toISOString(), returnAt: o.returnAt?.toISOString() ?? null })),
    awayMinutes: j.awayMinutes,
    incompleteSequence: j.incompleteSequence,
    onSite: j.onSite,
    ...over,
  };
};

/**
 * Alinea las sesiones de UNA persona (su lista completa, antes de agrupar por
 * día). Las sesiones sin `punches` (p. ej. la bitácora de acceso) no se tocan.
 */
export const alignSessionsToSchedules = <T extends AlignableSession>(
  sessions: T[],
  scheduleFor: (dayKey: string) => WorkdaySchedule | null,
  timezone: string,
  nowMs: number
): T[] => {
  const clock = sessions.filter((s) => s.punches && s.punches.length > 0);
  if (clock.length === 0) return sessions;
  const others = sessions.filter((s) => !s.punches || s.punches.length === 0);

  const owner = new Map<number, T>();
  for (const s of clock) for (const p of s.punches ?? []) owner.set(Date.parse(p), s);
  const instants = [...owner.keys()].sort((a, b) => a - b).map((ms) => new Date(ms));

  const boundariesAround = (t: Date): Boundary[] => {
    const day = localDateKey(t, timezone);
    return [addDays(day, -1), day].flatMap((shiftDay) => {
      const w = shiftWindow(scheduleFor(shiftDay), shiftDay, timezone);
      if (!w) return [];
      const base = { shiftDay, shiftEnd: w.end, exitToleranceMin: w.exitToleranceMin };
      return [
        { ...base, kind: "START" as const, at: w.start },
        { ...base, kind: "END" as const, at: w.end },
      ];
    });
  };
  const nearest = (t: Date): Boundary | null =>
    boundariesAround(t).reduce<Boundary | null>(
      (best, b) => (!best || Math.abs(b.at - t.getTime()) < Math.abs(best.at - t.getTime()) ? b : best),
      null
    );

  const out: T[] = [];
  let i = 0;
  while (i < instants.length) {
    const [j] = buildTimeline(instants.slice(i), 0, nowMs);
    const firstPunch = j.punches[0];
    const first = nearest(firstPunch);
    const template = owner.get(firstPunch.getTime()) as T;

    // Primera checada cerca de un fin de turno y el resto en otro turno (o no hay resto).
    if (first?.kind === "END") {
      const rest = j.punches.slice(1);
      const last = rest.length > 0 ? nearest(rest[rest.length - 1]) : null;
      if (rest.length === 0 || (last && last.shiftDay !== first.shiftDay)) {
        out.push({
          ...template,
          id: `${template.id}#${firstPunch.getTime()}`,
          date: first.shiftDay,
          entryAt: null,
          exitAt: firstPunch.toISOString(),
          workedMinutes: 0,
          incident: "EXIT_WITHOUT_ENTRY",
          crossesMidnight: false,
          punches: [firstPunch.toISOString()],
          outings: [],
          awayMinutes: 0,
          incompleteSequence: false,
          onSite: false,
        });
        i += 1;
        continue;
      }
    }

    // Entrada sola que ya rebasó el fin de su turno: no sigue abierta.
    const expired =
      j.punches.length === 1 &&
      first?.kind === "START" &&
      j.incident === "OPEN_ENTRY" &&
      nowMs > first.shiftEnd + (first.exitToleranceMin + OPEN_ENTRY_MARGIN_MIN) * MS_PER_MINUTE;

    const original = owner.get(firstPunch.getTime());
    const unchanged =
      !expired && original && original.punches?.length === j.punches.length && original.entryAt === firstPunch.toISOString();
    out.push(
      unchanged && original
        ? original
        : toSession(template, j, timezone, expired ? { incident: "ENTRY_WITHOUT_EXIT", onSite: false } : {})
    );
    i += j.punches.length;
  }

  return [...others, ...out];
};

/** Alinea las sesiones de varias personas: agrupa por `employeeId` y respeta el orden de aparición. */
export const alignByPerson = <T extends AlignableSession & { employeeId: string }>(
  sessions: T[],
  scheduleFor: (employeeId: string, dayKey: string) => WorkdaySchedule | null,
  timezone: string,
  nowMs: number
): T[] => {
  const byPerson = new Map<string, T[]>();
  for (const s of sessions) {
    const list = byPerson.get(s.employeeId);
    if (list) list.push(s);
    else byPerson.set(s.employeeId, [s]);
  }
  return [...byPerson].flatMap(([id, list]) =>
    alignSessionsToSchedules(list, (day) => scheduleFor(id, day), timezone, nowMs)
  );
};
