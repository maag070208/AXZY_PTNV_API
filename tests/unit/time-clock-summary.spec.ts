import { test, expect } from "@playwright/test";
import {
  buildAlerts,
  classifyConnection,
  hourlyCounts,
  type ClockFacts,
  type RosterFacts,
} from "../../src/modules/time-clock/services/clock-summary";

// Resumen de estado del reloj (RELOJ_DASHBOARD.md, fase 1). Lógica pura.

const clock = (over: Partial<ClockFacts> = {}): ClockFacts => ({
  serial: "S1",
  name: "Reloj",
  countsAttendance: true,
  connection: "ONLINE",
  lastSyncAt: null,
  lastSyncOk: true,
  lastSyncError: null,
  ...over,
});

const roster = (over: Partial<RosterFacts> = {}): RosterFacts => ({
  suspicious: false,
  pendingRemovals: 0,
  reappeared: 0,
  unlinked: 0,
  ...over,
});

test.describe("clasificación de conexión", () => {
  test("sin intento, lectura correcta, rechazo de credenciales y sin respuesta", () => {
    expect(classifyConnection(null)).toBe("NOT_READ");
    expect(classifyConnection({ ok: true })).toBe("ONLINE");
    expect(classifyConnection({ ok: false, authError: true, message: "401" })).toBe("PAUSED_CREDENTIALS");
    expect(classifyConnection({ ok: false, authError: false, message: "ECONNREFUSED" })).toBe("NO_RESPONSE");
  });
});

test.describe("alertas", () => {
  test("sin problemas, no hay alertas", () => {
    expect(buildAlerts(clock(), roster())).toEqual([]);
  });

  test("el reloj sin respuesta va primero, aunque haya más alertas", () => {
    const alerts = buildAlerts(
      clock({ connection: "NO_RESPONSE" }),
      roster({ pendingRemovals: 2, unlinked: 1, suspicious: true })
    );
    expect(alerts.map((a) => a.code)).toEqual(["NO_RESPONSE", "SUSPICIOUS_ROSTER", "PENDING_REMOVALS", "UNLINKED"]);
    expect(alerts[0].severity).toBe("critical");
  });

  test("credenciales rechazadas y error de sincronización", () => {
    const alerts = buildAlerts(clock({ connection: "PAUSED_CREDENTIALS", lastSyncOk: false }), roster());
    expect(alerts.map((a) => a.code)).toEqual(["CREDENTIALS", "SYNC_ERROR"]);
  });

  test("las cuentas viajan en la alerta", () => {
    const [alert] = buildAlerts(clock(), roster({ reappeared: 3 }));
    expect(alert).toEqual({ code: "REAPPEARED", severity: "warning", count: 3 });
  });
});

test.describe("checadas de hoy por hora", () => {
  const tz = "America/Mexico_City";

  test("cuenta solo las checadas del día local y las agrupa por hora", () => {
    // 2026-10-22 09:30 y 09:45 hora de México (UTC-6), y una de ayer.
    const now = new Date("2026-10-22T12:00:00Z");
    const counts = hourlyCounts(
      [
        new Date("2026-10-22T15:30:00Z"),
        new Date("2026-10-22T15:45:00Z"),
        new Date("2026-10-21T15:30:00Z"),
      ],
      tz,
      now
    );
    expect(counts).toHaveLength(24);
    expect(counts[9].count).toBe(2);
    expect(counts.reduce((sum, h) => sum + h.count, 0)).toBe(2);
  });
});
