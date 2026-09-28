import { test, expect } from "@playwright/test";
import {
  computeWorkday,
  minutesBetween,
  toMinutes,
  weekdayOf,
  type WorkdaySchedule,
} from "../../src/modules/schedules/services/workday-rules";

/**
 * Regla única de la jornada (horas programadas, tiempo extra y faltante), la
 * misma que alimenta el reporte de Nómina y la aprobación de horas extra.
 */

const TZ = "UTC";
const DAY = "2026-09-21"; // lunes

const scheduleOf = (over: Partial<WorkdaySchedule["days"][number]> = {}, sched: Partial<WorkdaySchedule> = {}): WorkdaySchedule => ({
  name: "Demo",
  exitToleranceMin: 0,
  mealBreakMin: 0,
  minOvertimeMin: 60,
  crossesMidnight: false,
  days: [
    {
      weekday: weekdayOf(DAY),
      startTime: "09:00",
      endTime: "17:00",
      splitStartTime: null,
      splitEndTime: null,
      restDay: false,
      ...over,
    },
  ],
  ...sched,
});

const at = (hhmm: string, day = DAY): string => {
  const [h, m] = hhmm.split(":").map(Number);
  const base = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(base + (h * 60 + m) * 60_000).toISOString();
};

test.describe("computeWorkday", () => {
  test("sin horario: se cuenta lo trabajado pero NO genera extra", () => {
    const w = computeWorkday(DAY, [{ exitAt: at("19:00"), workedMinutes: 600 }], null, TZ);
    expect(w).toMatchObject({ workedMin: 600, scheduledMin: 480, extraMin: 0, missingMin: 0, withoutSchedule: true });
  });

  test("sin horario y por debajo de la jornada: cuenta el faltante", () => {
    const w = computeWorkday(DAY, [{ exitAt: at("14:00"), workedMinutes: 300 }], null, TZ);
    expect(w).toMatchObject({ workedMin: 300, extraMin: 0, missingMin: 180, withoutSchedule: true });
  });

  test("sin checar: no hay faltante (no se sabe si le tocaba)", () => {
    const w = computeWorkday(DAY, [], null, TZ);
    expect(w).toMatchObject({ workedMin: 0, extraMin: 0, missingMin: 0 });
  });

  test("día laboral: el extra es lo trabajado después de la salida programada", () => {
    const w = computeWorkday(DAY, [{ exitAt: at("18:30"), workedMinutes: 570 }], scheduleOf(), TZ);
    // 17:00 programada + 90 min trabajados después = extra 90 (mínimo 60).
    expect(w).toMatchObject({ scheduledMin: 480, extraMin: 90, restDay: false, withoutSchedule: false });
  });

  test("día laboral sin pasarse: extra 0 y faltante por lo no trabajado", () => {
    const w = computeWorkday(DAY, [{ exitAt: at("15:00"), workedMinutes: 360 }], scheduleOf(), TZ);
    expect(w).toMatchObject({ scheduledMin: 480, extraMin: 0, missingMin: 120 });
  });

  test("la tolerancia de salida se descuenta del extra y el mínimo lo filtra", () => {
    const schedule = scheduleOf({}, { exitToleranceMin: 30, minOvertimeMin: 60 });
    const w = computeWorkday(DAY, [{ exitAt: at("18:15"), workedMinutes: 555 }], schedule, TZ);
    // 75 min después de las 17:00 − 30 de tolerancia = 45 < 60 → no cuenta.
    expect(w.extraMin).toBe(0);
  });

  test("descanso trabajado: todo lo trabajado es extra", () => {
    const schedule = scheduleOf({ restDay: true });
    const w = computeWorkday(DAY, [{ exitAt: at("12:00"), workedMinutes: 120 }], schedule, TZ);
    expect(w).toMatchObject({ restDay: true, scheduledMin: 0, extraMin: 120, missingMin: 0 });
  });

  test("turno que cruza la medianoche no cuenta la salida como extra", () => {
    const schedule = scheduleOf(
      { startTime: "23:00", endTime: "07:00" },
      { crossesMidnight: true }
    );
    expect(minutesBetween("23:00", "07:00")).toBe(480);
    const w = computeWorkday(DAY, [{ exitAt: at("07:00", "2026-09-22"), workedMinutes: 480 }], schedule, TZ);
    expect(w.scheduledMin).toBe(480);
    expect(w.extraMin).toBe(0);
    expect(w.restDay).toBe(false);
    expect(toMinutes("07:00")).toBeLessThan(toMinutes("23:00"));
  });
});
