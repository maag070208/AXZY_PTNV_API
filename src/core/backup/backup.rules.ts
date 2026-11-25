/**
 * Reglas puras de los respaldos automáticos (sin I/O): argumentos de `pg_dump`,
 * nombre de archivo y selección de retención. Todo lo que toca disco o procesos
 * vive en `backup.service.ts`.
 */

export type BackupReason = "daily" | "pre-migrate";

export const BACKUP_REASONS: readonly BackupReason[] = ["daily", "pre-migrate"];

export const isBackupReason = (value: unknown): value is BackupReason =>
  typeof value === "string" && (BACKUP_REASONS as readonly string[]).includes(value);

export interface PgDumpCommand {
  args: string[];
  /** Variables extra para el proceso: la contraseña va aquí, nunca en argv. */
  env: Record<string, string>;
}

/**
 * Convierte `DATABASE_URL` (con `?schema=public` y otros parámetros de Prisma,
 * que `pg_dump` no acepta) en argumentos discretos + `PGPASSWORD`.
 * Usuario/contraseña/base se decodifican (caracteres especiales con %xx).
 */
export const buildPgDumpCommand = (databaseUrl: string, outFile: string): PgDumpCommand => {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a postgres connection string");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL has no database name");

  const args = ["--format=custom", "--no-owner", "--file", outFile];
  if (url.hostname) args.push("--host", decodeURIComponent(url.hostname));
  if (url.port) args.push("--port", url.port);
  if (url.username) args.push("--username", decodeURIComponent(url.username));
  args.push("--dbname", database);

  const env: Record<string, string> = {};
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  return { args, env };
};

/** `YYYYMMDD-HHmmss` del instante en la zona dada. */
export const formatBackupStamp = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
};

export const backupFileName = (instant: Date, timeZone: string, reason: BackupReason): string =>
  `cartas-${formatBackupStamp(instant, timeZone)}-${reason}.dump`;

const BACKUP_NAME_RE = /^cartas-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(daily|pre-migrate)\.dump$/;

export interface ParsedBackupName {
  name: string;
  reason: BackupReason;
  /** Sello del nombre como `YYYYMMDDHHmmss` (ordenable como texto). */
  stamp: string;
}

/** `null` si el archivo no sigue el patrón (nunca se toca). */
export const parseBackupName = (name: string): ParsedBackupName | null => {
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return null;
  return { name, reason: m[7] as BackupReason, stamp: m.slice(1, 7).join("") };
};

export interface RetentionPolicy {
  keepDays: number;
  keepPreMigrate: number;
}

export interface RetentionFile {
  name: string;
  mtimeMs: number;
}

/**
 * Qué archivos borrar: los `daily` con más de `keepDays` días (por fecha de
 * modificación) y los `pre-migrate` salvo los `keepPreMigrate` más recientes
 * (por sello del nombre). Lo que no cumple el patrón nunca se devuelve.
 */
export const selectBackupsToDelete = (
  files: readonly RetentionFile[],
  policy: RetentionPolicy,
  nowMs: number
): string[] => {
  const cutoff = nowMs - policy.keepDays * 24 * 60 * 60 * 1000;
  const daily: string[] = [];
  const preMigrate: ParsedBackupName[] = [];
  for (const file of files) {
    const parsed = parseBackupName(file.name);
    if (!parsed) continue;
    if (parsed.reason === "daily") {
      if (file.mtimeMs < cutoff) daily.push(file.name);
    } else {
      preMigrate.push(parsed);
    }
  }
  preMigrate.sort((a, b) => b.stamp.localeCompare(a.stamp));
  const oldPreMigrate = preMigrate.slice(Math.max(0, policy.keepPreMigrate)).map((p) => p.name);
  return [...daily, ...oldPreMigrate];
};

/** ¿Hace falta un respaldo diario ya? (no hay ninguno o el último tiene más de 24 h). */
export const isDailyBackupDue = (newestDailyMtimeMs: number | null, nowMs: number): boolean =>
  newestDailyMtimeMs === null || nowMs - newestDailyMtimeMs > 24 * 60 * 60 * 1000;

/** Milisegundos hasta la próxima hora `hour` (0-23) en la zona local dada. */
export const msUntilNextHour = (now: Date, hour: number, timeZone: string): number => {
  const stamp = formatBackupStamp(now, timeZone); // YYYYMMDD-HHmmss
  const h = Number(stamp.slice(9, 11));
  const m = Number(stamp.slice(11, 13));
  const s = Number(stamp.slice(13, 15));
  let diffSec = (hour - h) * 3600 - m * 60 - s;
  if (diffSec <= 0) diffSec += 24 * 3600;
  return diffSec * 1000;
};
