import { test, expect } from "@playwright/test";
import { buildTimeline } from "../../src/modules/time-clock/services/time-clock-timeline";
import {
  alignSessionsToSchedules,
  type AlignableSession,
} from "../../src/modules/schedules/services/shift-alignment";
import { computeWorkday, weekdayOf, type WorkdaySchedule } from "../../src/modules/schedules/services/workday-rules";

/**
 * Alineación de checadas al horario: una salida sin entrada no se toma como
 * entrada ni se fusiona con la entrada del día siguiente.
 */

const TZ = "UTC";
const D1 = "2026-09-21";
const D2 = "2026-09-22";
const at = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00.000Z`);

const scheduleOf = (startTime: string, endTime: string, crossesMidnight = false): WorkdaySchedule => ({
  name: "Demo",
  entryToleranceMin: 10,
  exitToleranceMin: 0,
  mealBreakMin: 0,
  minOvertimeMin: 60,
  crossesMidnight,
  days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startTime,
    endTime,
    splitStartTime: null,
    splitEndTime: null,
    restDay: false,
  })),
});
const DAY_SHIFT = scheduleOf("07:00", "19:00");
const NIGHT_SHIFT = scheduleOf("19:00", "07:00", true);

/** Sesiones como las entrega el reloj: `buildTimeline` sobre las checadas. */
const sessionsOf = (punches: Date[], nowMs: number): AlignableSession[] =>
  buildTimeline(punches, 0, nowMs).map((j, i) => ({
    id: `s${i}`,
    date: j.entryAt.toISOString().slice(0, 10),
    entryAt: j.entryAt.toISOString(),
    exitAt: j.exitAt?.toISOString() ?? null,
    workedMinutes: j.exitAt ? Math.round((j.exitAt.getTime() - j.entryAt.getTime()) / 60000) : 0,
    incident: j.incident,
    crossesMidnight: false,
    punches: j.punches.map((p) => p.toISOString()),
    outings: [],
    awayMinutes: 0,
    incompleteSequence: false,
    onSite: j.onSite,
  }));

const NOW = at("2026-09-30", "12:00").getTime();
const align = (punches: Date[], schedule: WorkdaySchedule | null, now = NOW) =>
  alignSessionsToSchedules(sessionsOf(punches, now), () => schedule, TZ, now);

test.describe("alignSessionsToSchedules", () => {
  test("(a) checada sola a las 19:00 en turno 07-19: salida sin entrada, sin extra", () => {
    const [s, ...rest] = align([at(D1, "19:00")], DAY_SHIFT);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      entryAt: null,
      exitAt: at(D1, "19:00").toISOString(),
      workedMinutes: 0,
      onSite: false,
      incident: "EXIT_WITHOUT_ENTRY",
      date: D1,
    });
    const w = computeWorkday(D1, [s], DAY_SHIFT, TZ);
    expect(w).toMatchObject({ workedMin: 0, extraMin: 0 });
  });

  test("(b) 19:00 solo + 06:55 y 19:05 del día siguiente: no se fusionan", () => {
    const out = align([at(D1, "19:00"), at(D2, "06:55"), at(D2, "19:05")], DAY_SHIFT);
    expect(out).toHaveLength(2);
    const day1 = out.filter((s) => s.date === D1);
    const day2 = out.filter((s) => s.date === D2);
    expect(day1).toHaveLength(1);
    expect(day1[0].incident).toBe("EXIT_WITHOUT_ENTRY");
    expect(day2).toHaveLength(1);
    expect(day2[0]).toMatchObject({ entryAt: at(D2, "06:55").toISOString(), exitAt: at(D2, "19:05").toISOString() });
    expect(computeWorkday(D1, day1, DAY_SHIFT, TZ).extraMin).toBe(0);
    expect(computeWorkday(D2, day2, DAY_SHIFT, TZ).extraMin).toBe(0);
  });

  test("(c) turno nocturno: 18:55 + 07:05 es una sesión; 07:05 solo es salida del día previo", () => {
    const full = align([at(D1, "18:55"), at(D2, "07:05")], NIGHT_SHIFT);
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ date: D1, incident: null, exitAt: at(D2, "07:05").toISOString() });

    const [lone] = align([at(D2, "07:05")], NIGHT_SHIFT);
    expect(lone).toMatchObject({ date: D1, entryAt: null, incident: "EXIT_WITHOUT_ENTRY", workedMinutes: 0 });
  });

  test("(d) llegada tardía 15:00 + salida 19:00 sigue siendo una sesión", () => {
    const out = align([at(D1, "15:00"), at(D1, "19:00")], DAY_SHIFT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entryAt: at(D1, "15:00").toISOString(), exitAt: at(D1, "19:00").toISOString() });
    expect(computeWorkday(D1, out, DAY_SHIFT, TZ).lateMin).toBe(480);
  });

  test("(e) entrada abierta pasado el fin del turno: entrada sin salida, no en sitio", () => {
    // Fin 19:00; a las 21:30 ya pasó margen (60 min); el tope de 13 h aún no.
    const now = at(D1, "21:30").getTime();
    const [s] = align([at(D1, "07:00")], DAY_SHIFT, now);
    expect(s).toMatchObject({ incident: "ENTRY_WITHOUT_EXIT", onSite: false });

    // Dentro del turno sigue abierta.
    const [open] = align([at(D1, "07:00")], DAY_SHIFT, at(D1, "10:00").getTime());
    expect(open).toMatchObject({ incident: "OPEN_ENTRY", onSite: true });
  });

  test("(f) sin horario: las sesiones no cambian", () => {
    const sessions = sessionsOf([at(D1, "19:00"), at(D2, "06:55")], NOW);
    const out = alignSessionsToSchedules(sessions, () => null, TZ, NOW);
    expect(out).toEqual(sessions);
  });

  test("sesiones sin punches (acceso) no se tocan", () => {
    const plain: AlignableSession = {
      id: "a",
      date: D1,
      entryAt: at(D1, "19:00").toISOString(),
      exitAt: null,
      workedMinutes: 0,
      incident: "OPEN_ENTRY",
      crossesMidnight: false,
    };
    expect(alignSessionsToSchedules([plain], () => DAY_SHIFT, TZ, NOW)).toEqual([plain]);
  });

  test("weekdayOf se usa solo para armar el horario de prueba", () => {
    expect(weekdayOf(D1)).toBe(1);
  });
});
