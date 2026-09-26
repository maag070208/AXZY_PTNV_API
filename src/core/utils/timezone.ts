import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Utilidades de zona horaria sin dependencias externas: `Intl.DateTimeFormat`
 * (ICU completo en Node) basta para calcular boundaries locales.
 *
 * El contenedor de la API corre en UTC, así que NUNCA se confía en el TZ del
 * proceso para decidir a qué día pertenece un instante. Todo boundary local se
 * calcula contra una zona IANA explícita (por defecto `America/Mexico_City`).
 */

/** Zona horaria oficial del cliente cuando nada más la define. */
export const DEFAULT_TIMEZONE = "America/Mexico_City";

/** Clave de `sys_config`/env que fija la zona horaria del reporte. */
export const TIMEZONE_CONFIG_KEY = "ACCESS_REPORT_TIMEZONE";

export type ReportPeriod = "DAY" | "WEEK" | "MONTH";

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/** `true` si `tz` es una zona IANA reconocida por ICU. */
export const isValidTimezone = (tz: string): boolean => {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Resuelve la zona horaria con la precedencia:
 * `explicit` → `ACCESS_REPORT_TIMEZONE` (env) → `TZ` (env) → `America/Mexico_City`.
 * Un `explicit` inválido es un error de cliente (400), no un fallback silencioso.
 */
export const resolveTimezone = (explicit?: string | null): string => {
  if (explicit != null && explicit !== "") {
    if (isValidTimezone(explicit)) return explicit;
    throw new HttpError(400, "INVALID_TIMEZONE", { timezone: explicit });
  }
  const candidates = [process.env[TIMEZONE_CONFIG_KEY], process.env.TZ];
  for (const candidate of candidates) {
    if (candidate && isValidTimezone(candidate)) return candidate;
  }
  return DEFAULT_TIMEZONE;
};

/** Lector de configuración (p. ej. `sys_config`) para resolver la TZ. */
export type TimezoneConfigReader = (key: string) => Promise<string | null>;

/**
 * Resuelve la zona horaria aplicando la precedencia COMPLETA del módulo de
 * acceso, idéntica para bitácora y reporte:
 * `explicit` → `sys_config.ACCESS_REPORT_TIMEZONE` (si hay lector) →
 * env `ACCESS_REPORT_TIMEZONE` → env `TZ` → `America/Mexico_City`.
 * Un `explicit` inválido es un error de cliente (400), no un fallback silencioso.
 */
export const resolveTimezoneWithConfig = async (
  explicit: string | null | undefined,
  reader?: TimezoneConfigReader
): Promise<string> => {
  if (explicit != null && explicit !== "") return resolveTimezone(explicit);
  const fromConfig = reader ? await reader(TIMEZONE_CONFIG_KEY) : null;
  return resolveTimezone(fromConfig ?? undefined);
};

/** `true` si `value` es una fecha de calendario `YYYY-MM-DD` real. */
export const isValidDateKey = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(m) &&
    dt.getUTCDate() === Number(d)
  );
};

/** Valida y descompone una fecha `YYYY-MM-DD`; lanza 400 con `code` si es inválida. */
export const assertDateKey = (value: unknown, code = "INVALID_DATE"): string => {
  if (!isValidDateKey(value)) {
    throw new HttpError(400, "INVALID_DATE_FORMAT", { value: String(value) });
  }
  return value;
};

const parseDateKey = (value: string): CalendarDate => {
  const match = DATE_KEY_RE.exec(value)!;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
};

const addDays = (date: CalendarDate, days: number): CalendarDate => {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

const addMonths = (date: CalendarDate, months: number): CalendarDate => {
  const dt = new Date(Date.UTC(date.y, date.m - 1 + months, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: 1 };
};

/** Offset (ms) de la zona `tz` respecto a UTC en el instante dado. */
const offsetMs = (instant: number, tz: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - instant;
};

/** Instante UTC correspondiente a una hora de pared en la zona `tz`. */
const zonedTimeToUtc = (date: CalendarDate, tz: string): Date => {
  const guess = Date.UTC(date.y, date.m - 1, date.d, 0, 0, 0);
  // Dos pasadas para absorber cambios de offset (DST) en el borde del día.
  const first = guess - offsetMs(guess, tz);
  const refined = guess - offsetMs(first, tz);
  return new Date(refined);
};

/** Fecha local (`YYYY-MM-DD`) de un instante en la zona `tz`. */
export const localDateKey = (instant: Date, tz: string): string => {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

/** Inicio (inclusive) del día local `dateKey` en la zona `tz`. */
export const startOfLocalDay = (dateKey: string, tz: string): Date =>
  zonedTimeToUtc(parseDateKey(assertDateKey(dateKey)), tz);

/** Fin EXCLUSIVO del día local `dateKey` en la zona `tz` (inicio del día siguiente). */
export const endOfLocalDay = (dateKey: string, tz: string): Date =>
  zonedTimeToUtc(addDays(parseDateKey(assertDateKey(dateKey)), 1), tz);

/** Rango `[start, end)` del día local `dateKey`. */
export const localDayRange = (dateKey: string, tz: string): { start: Date; end: Date } => ({
  start: startOfLocalDay(dateKey, tz),
  end: endOfLocalDay(dateKey, tz),
});

/** Rango `[start, end)` de la semana ISO 8601 (lunes–domingo) que contiene `dateKey`. */
export const localWeekRange = (dateKey: string, tz: string): { start: Date; end: Date } => {
  const date = parseDateKey(assertDateKey(dateKey));
  const utcDay = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  const isoDay = utcDay === 0 ? 7 : utcDay; // lunes=1 … domingo=7
  const monday = addDays(date, -(isoDay - 1));
  const nextMonday = addDays(monday, 7);
  return { start: zonedTimeToUtc(monday, tz), end: zonedTimeToUtc(nextMonday, tz) };
};

/** Rango `[start, end)` del mes calendario que contiene `dateKey`. */
export const localMonthRange = (dateKey: string, tz: string): { start: Date; end: Date } => {
  const date = parseDateKey(assertDateKey(dateKey));
  const first = { y: date.y, m: date.m, d: 1 };
  return { start: zonedTimeToUtc(first, tz), end: zonedTimeToUtc(addMonths(first, 1), tz) };
};

/** Resuelve `[start, end)` para `DAY`/`WEEK`/`MONTH` sobre la fecha local `dateKey`. */
export const resolveReportRange = (
  period: ReportPeriod,
  dateKey: string,
  tz: string
): { start: Date; end: Date } => {
  switch (period) {
    case "DAY":
      return localDayRange(dateKey, tz);
    case "WEEK":
      return localWeekRange(dateKey, tz);
    case "MONTH":
      return localMonthRange(dateKey, tz);
  }
};

/**
 * Convierte un filtro de fecha del contrato de tablas a instante:
 * - `YYYY-MM-DD` → boundary LOCAL en `tz` (start = inicio del día; end = inicio
 *   del día siguiente, EXCLUSIVO).
 * - string con `T` → instante absoluto (retrocompatible con el contrato viejo).
 * - cualquier otra cosa → 400.
 */
export const parseDateFilter = (
  value: unknown,
  tz: string,
  edge: "start" | "end"
): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value);
  if (raw.includes("T")) {
    const instant = new Date(raw);
    if (Number.isNaN(instant.getTime())) {
      throw new HttpError(400, "INVALID_DATE", { value: raw });
    }
    return instant;
  }
  const dateKey = assertDateKey(raw);
  return edge === "start" ? startOfLocalDay(dateKey, tz) : endOfLocalDay(dateKey, tz);
};
