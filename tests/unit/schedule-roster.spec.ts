import { test, expect } from "@playwright/test";
import { scheduleOn, type LoadedSchedules } from "../../src/modules/schedules/services/schedule-assignments";
import { computeWorkday, shiftOf, toUtcDate } from "../../src/modules/schedules/services/workday-rules";

/** Rol semanal: `scheduleOn` es pura, se evalúa sin base de datos. */

const day = (weekday: number, startTime: string | null, endTime: string | null, restDay = false) => ({
  id: `d${weekday}`,
  scheduleId: "x",
  weekday,
  startTime,
  endTime,
  splitStartTime: null,
  splitEndTime: null,
  restDay,
});

const schedule = (id: string, name: string, start: string, end: string, crossesMidnight = false) => ({
  id,
  name,
  active: true,
  entryToleranceMin: 5,
  exitToleranceMin: 5,
  mealBreakMin: 0,
  minOvertimeMin: 30,
  crossesMidnight,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  days: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, start, end)),
});

const MORNING = schedule("s-m", "MORNING", "07:00", "15:00");
const NIGHT = schedule("s-n", "NIGHT", "23:00", "07:00", true);
const MONDAY = "2026-11-23";
const TUESDAY = "2026-11-24";

const base = (userId = "u1") => ({
  id: "a1",
  userId,
  scheduleId: MORNING.id,
  validFrom: toUtcDate("2026-01-01"),
  validTo: null,
  createdAt: new Date(0),
  createdById: null,
  schedule: MORNING,
});

const entry = (date: string, sched: typeof NIGHT | null, restDay: boolean, userId = "u1") => ({
  id: `r-${date}`,
  userId,
  date: toUtcDate(date),
  scheduleId: sched?.id ?? null,
  restDay,
  createdById: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  schedule: sched,
});

test.describe("scheduleOn con rol semanal", () => {
  test("sin entrada de rol: horario base", () => {
    const loaded: LoadedSchedules = { assignments: [base()], roster: [] };
    expect(scheduleOn(loaded, "u1", MONDAY)?.name).toBe("MORNING");
    expect(scheduleOn(loaded, "u2", MONDAY)).toBeNull();
  });

  test("el turno del rol gana al horario base solo ese día", () => {
    const loaded: LoadedSchedules = { assignments: [base()], roster: [entry(MONDAY, NIGHT, false)] };
    expect(scheduleOn(loaded, "u1", MONDAY)?.name).toBe("NIGHT");
    expect(scheduleOn(loaded, "u1", TUESDAY)?.name).toBe("MORNING");
  });

  test("descanso del rol fuerza el día a descanso sobre el base", () => {
    const loaded: LoadedSchedules = { assignments: [base()], roster: [entry(MONDAY, null, true)] };
    const resolved = scheduleOn(loaded, "u1", MONDAY);
    expect(resolved?.name).toBe("MORNING");
    expect(resolved?.days).toEqual([expect.objectContaining({ weekday: 1, restDay: true, startTime: null })]);
    expect(shiftOf(resolved, MONDAY)).toBeNull();
    expect(computeWorkday(MONDAY, [], resolved, "America/Mexico_City")).toMatchObject({
      restDay: true,
      scheduledMin: 0,
      withoutSchedule: false,
    });
    // Otro día sigue con su turno.
    expect(shiftOf(scheduleOn(loaded, "u1", TUESDAY), TUESDAY)).toBe("07:00-15:00");
  });

  test("descanso sin horario base: valores por defecto y día de descanso", () => {
    const loaded: LoadedSchedules = { assignments: [], roster: [entry(MONDAY, null, true)] };
    const resolved = scheduleOn(loaded, "u1", MONDAY);
    expect(resolved).toMatchObject({ id: null, entryToleranceMin: 10, minOvertimeMin: 60 });
    const workday = computeWorkday(
      MONDAY,
      [{ exitAt: null, workedMinutes: 120 }],
      resolved,
      "America/Mexico_City"
    );
    expect(workday.restDay).toBe(true);
    expect(workday.extraMin).toBe(120);
  });

  test("turno nocturno 23:00-07:00 del rol se queda en su fecha", () => {
    const loaded: LoadedSchedules = { assignments: [base()], roster: [entry(MONDAY, NIGHT, false)] };
    const resolved = scheduleOn(loaded, "u1", MONDAY);
    expect(shiftOf(resolved, MONDAY)).toBe("23:00-07:00");
    // Sesión que empieza el lunes 23:00 y termina el martes 07:00 (480 min): sin extra ni faltante.
    const workday = computeWorkday(
      MONDAY,
      [{ entryAt: "2026-11-24T05:00:00.000Z", exitAt: "2026-11-24T13:00:00.000Z", workedMinutes: 480 }],
      resolved,
      "America/Mexico_City"
    );
    expect(workday).toMatchObject({ scheduledMin: 480, extraMin: 0, restDay: false, scheduleName: "NIGHT" });
    // El martes (sin entrada de rol) no hereda el turno nocturno.
    expect(shiftOf(scheduleOn(loaded, "u1", TUESDAY), TUESDAY)).toBe("07:00-15:00");
  });
});
