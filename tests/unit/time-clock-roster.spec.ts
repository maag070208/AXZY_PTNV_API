import { test, expect } from "@playwright/test";
import {
  planRoster,
  ROSTER_GRACE_MS,
  type RosterLink,
  type RosterReading,
} from "../../src/modules/time-clock/services/roster-plan";

// Reglas del padrón del reloj (TIME_CLOCK_SYNC.md §3). Lógica pura, sin BD.

const T0 = new Date("2026-10-21T08:00:00Z");
const DAY = ROSTER_GRACE_MS;

const link = (over: Partial<RosterLink> & { employeeNumber: string }): RosterLink => ({
  userActive: true,
  status: "ACTIVE",
  missingRuns: 0,
  missingSince: null,
  reappearedAt: null,
  ...over,
});

const okReading = (serial: string, numbers: string[], previous = numbers): RosterReading => ({
  clockSerial: serial,
  ok: true,
  numbers,
  previousNumbers: previous,
});

const failedReading = (serial: string, previous: string[]): RosterReading => ({
  clockSerial: serial,
  ok: false,
  numbers: [],
  previousNumbers: previous,
});

test.describe("padrón del reloj: lectura", () => {
  test("sin ninguna lectura válida no hay cambios", () => {
    const plan = planRoster({
      now: T0,
      readings: [failedReading("A", ["1"])],
      links: [link({ employeeNumber: "1", missingRuns: 2, missingSince: new Date(T0.getTime() - 2 * DAY) })],
    });
    expect(plan.noRun).toBe(true);
    expect(plan.changes).toEqual([]);
  });

  test("un reloj que falla conserva a sus personas como presentes (R4)", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", []), failedReading("B", ["7"])],
      links: [link({ employeeNumber: "7", missingRuns: 2, missingSince: new Date(T0.getTime() - 2 * DAY) })],
    });
    expect(plan.noRun).toBe(false);
    expect(plan.changes).toEqual([{ employeeNumber: "7", missingRuns: 0, missingSince: null }]);
  });

  test("las personas nuevas en el reloj quedan como NUEVO (sin vínculo)", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["9", "5"], ["5"])],
      links: [],
    });
    // "5" está en el reloj pero no tiene vínculo: también es NUEVO.
    expect(plan.newNumbers).toEqual(["5", "9"]);
    expect(plan.added).toBe(1);
  });
});

test.describe("padrón del reloj: bajas pendientes (R10–R11)", () => {
  const missingLink = (runs: number, since: Date) =>
    link({ employeeNumber: "1", missingRuns: runs, missingSince: since });

  test("una corrida sin aparecer no basta", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", [])],
      links: [link({ employeeNumber: "1" })],
    });
    expect(plan.changes).toEqual([
      { employeeNumber: "1", missingRuns: 1, missingSince: T0 },
    ]);
  });

  test("3 corridas pero menos de 24 h no basta", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", [])],
      links: [missingLink(2, new Date(T0.getTime() - 3600_000))],
    });
    expect(plan.changes[0]).toMatchObject({ missingRuns: 3 });
    expect(plan.changes[0].status).toBeUndefined();
    expect(plan.changes[0].event).toBeUndefined();
  });

  test("3 corridas y 24 h sin aparecer pasan a PENDING_REMOVAL sin tocar al usuario", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", [])],
      links: [missingLink(2, new Date(T0.getTime() - DAY))],
    });
    expect(plan.changes[0]).toMatchObject({ status: "PENDING_REMOVAL", event: "REMOVAL_PENDING" });
  });

  test("una persona que ya no está en ningún reloj que cuenta pasa a pendiente solo si el usuario sigue activo", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", [])],
      links: [link({ employeeNumber: "1", userActive: false, missingRuns: 2, missingSince: new Date(T0.getTime() - DAY) })],
    });
    expect(plan.changes).toEqual([]);
  });
});

test.describe("padrón del reloj: reapariciones (R16–R17)", () => {
  test("reaparece con baja pendiente: se cancela sin motivo", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["1"])],
      links: [link({ employeeNumber: "1", status: "PENDING_REMOVAL", missingRuns: 3, missingSince: T0 })],
    });
    expect(plan.changes).toContainEqual({
      employeeNumber: "1",
      status: "ACTIVE",
      event: "REMOVAL_CANCELLED",
      missingRuns: 0,
      missingSince: null,
    });
  });

  test("reaparece un usuario ya dado de baja: se marca una sola vez (reappearedAt)", () => {
    const first = planRoster({
      now: T0,
      readings: [okReading("A", ["1"])],
      links: [link({ employeeNumber: "1", userActive: false })],
    });
    expect(first.changes).toEqual([{ employeeNumber: "1", reappearedAt: T0, event: "REAPPEARED" }]);

    const second = planRoster({
      now: T0,
      readings: [okReading("A", ["1"])],
      links: [link({ employeeNumber: "1", userActive: false, reappearedAt: T0 })],
    });
    expect(second.changes).toEqual([]);
  });

  test("un usuario activo que tenía reappearedAt lo limpia (ya fue reactivado)", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["1"])],
      links: [link({ employeeNumber: "1", reappearedAt: T0 })],
    });
    expect(plan.changes).toEqual([{ employeeNumber: "1", reappearedAt: null }]);
  });
});

test.describe("padrón del reloj: guarda de caída masiva (R5)", () => {
  test("una caída de más de 20 % marca la corrida como sospechosa y no genera bajas", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["1", "2"], ["1", "2", "3", "4", "5"])],
      links: [link({ employeeNumber: "5", missingRuns: 2, missingSince: new Date(T0.getTime() - 2 * DAY) })],
    });
    expect(plan.suspicious).toBe(true);
    expect(plan.replaceClocks).toEqual([]);
    expect(plan.noRun).toBe(true);
    expect(plan.changes).toEqual([]);
  });

  test("una caída de exactamente 20 % no es sospechosa", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["1", "2", "3", "4"], ["1", "2", "3", "4", "5"])],
      links: [],
    });
    expect(plan.suspicious).toBe(false);
    expect(plan.replaceClocks).toEqual(["A"]);
  });

  test("una lectura sospechosa no se confía: si es el único reloj, no hay cambios", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["4"], ["1", "2", "3", "4", "5"])],
      links: [link({ employeeNumber: "4", status: "PENDING_REMOVAL", missingRuns: 3, missingSince: T0 })],
    });
    expect(plan.suspicious).toBe(true);
    expect(plan.noRun).toBe(true);
    expect(plan.changes).toEqual([]);
  });

  test("con otro reloj confiable, una persona que reaparece cancela su pendiente aunque haya una caída", () => {
    const plan = planRoster({
      now: T0,
      readings: [okReading("A", ["4"], ["1", "2", "3", "4", "5"]), okReading("B", ["4"], ["4"])],
      links: [link({ employeeNumber: "4", status: "PENDING_REMOVAL", missingRuns: 3, missingSince: T0 })],
    });
    expect(plan.suspicious).toBe(true);
    expect(plan.changes).toContainEqual(expect.objectContaining({ employeeNumber: "4", event: "REMOVAL_CANCELLED" }));
    expect(plan.changes.some((c) => c.event === "REMOVAL_PENDING")).toBe(false);
  });
});
