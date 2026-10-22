import { localDateKey, startOfLocalDay } from "@core/utils/timezone";

/**
 * Resumen de estado del reloj (RELOJ_DASHBOARD.md §4.1). Lógica pura: sin base
 * de datos ni red. El servicio junta los datos y aquí se decide qué significan.
 */

export type ConnectionState = "ONLINE" | "NO_RESPONSE" | "PAUSED_CREDENTIALS" | "NOT_READ";

export type AlertCode =
  | "NO_RESPONSE"
  | "CREDENTIALS"
  | "SUSPICIOUS_ROSTER"
  | "PENDING_REMOVALS"
  | "REAPPEARED"
  | "UNLINKED"
  | "SYNC_ERROR";

/** Orden de prioridad de las alertas: primero lo que deja el reloj inservible. */
export const ALERT_PRIORITY: AlertCode[] = [
  "NO_RESPONSE",
  "CREDENTIALS",
  "SUSPICIOUS_ROSTER",
  "SYNC_ERROR",
  "PENDING_REMOVALS",
  "REAPPEARED",
  "UNLINKED",
];

export type ReadResult =
  | { ok: true }
  | { ok: false; authError: boolean; message: string }
  | null;

/** Lo que se sabe de un reloj que cuenta para asistencia, sin el padrón. */
export interface ClockFacts {
  serial: string;
  name: string | null;
  countsAttendance: boolean;
  connection: ConnectionState;
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
}

/** Estado global del padrón (vive en la base, no en el reloj). */
export interface RosterFacts {
  suspicious: boolean;
  pendingRemovals: number;
  reappeared: number;
  unlinked: number;
}

export interface ClockAlert {
  code: AlertCode;
  severity: "critical" | "warning" | "info";
  count?: number;
}

/**
 * Clasifica la conexión a partir de la última lectura del equipo. `null` = no
 * se intentó (p. ej. el reloj no tiene dirección).
 */
export const classifyConnection = (read: ReadResult): ConnectionState => {
  if (read === null) return "NOT_READ";
  if (read.ok) return "ONLINE";
  return read.authError ? "PAUSED_CREDENTIALS" : "NO_RESPONSE";
};

/** Alertas de un reloj y del padrón, en orden de prioridad. */
export const buildAlerts = (clock: ClockFacts, roster: RosterFacts): ClockAlert[] => {
  const alerts: ClockAlert[] = [];
  if (clock.connection === "NO_RESPONSE") alerts.push({ code: "NO_RESPONSE", severity: "critical" });
  if (clock.connection === "PAUSED_CREDENTIALS") alerts.push({ code: "CREDENTIALS", severity: "critical" });
  if (roster.suspicious) alerts.push({ code: "SUSPICIOUS_ROSTER", severity: "critical" });
  if (clock.lastSyncOk === false) alerts.push({ code: "SYNC_ERROR", severity: "warning" });
  if (roster.pendingRemovals > 0) {
    alerts.push({ code: "PENDING_REMOVALS", severity: "warning", count: roster.pendingRemovals });
  }
  if (roster.reappeared > 0) alerts.push({ code: "REAPPEARED", severity: "warning", count: roster.reappeared });
  if (roster.unlinked > 0) alerts.push({ code: "UNLINKED", severity: "info", count: roster.unlinked });
  return alerts.sort((a, b) => ALERT_PRIORITY.indexOf(a.code) - ALERT_PRIORITY.indexOf(b.code));
};

/**
 * Checadas de hoy por hora local (0–23), solo las que cuentan para asistencia.
 * `instants` son las horas de las checadas; `tz` la zona del reporte.
 */
export const hourlyCounts = (instants: Date[], tz: string, now: Date): { hour: number; count: number }[] => {
  const counts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const today = localDateKey(now, tz);
  const dayStart = startOfLocalDay(today, tz).getTime();
  for (const at of instants) {
    if (at.getTime() < dayStart) continue;
    if (localDateKey(at, tz) !== today) continue;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: tz }).format(at)
    );
    counts[hour % 24].count += 1;
  }
  return counts;
};
