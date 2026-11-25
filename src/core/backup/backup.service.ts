import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "@core/utils/logger";
import { resolveTimezone } from "@core/utils/timezone";
import {
  backupFileName,
  buildPgDumpCommand,
  parseBackupName,
  selectBackupsToDelete,
  type BackupReason,
  type RetentionPolicy,
} from "./backup.rules";

/**
 * Respaldos con `pg_dump`. Lee `process.env` directo (no `env.config`) porque
 * el CLI del arranque corre sin JWT_SECRET/PORT.
 */

export const DEFAULT_BACKUP_KEEP_DAYS = 14;
export const KEEP_PRE_MIGRATE = 10;

export const retentionFromEnv = (): RetentionPolicy => {
  const days = parseInt(process.env.BACKUP_KEEP_DAYS ?? "", 10);
  return {
    keepDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_BACKUP_KEEP_DAYS,
    keepPreMigrate: KEEP_PRE_MIGRATE,
  };
};

export interface BackupResult {
  ok: boolean;
  file?: string;
  bytes?: number;
  error?: string;
}

const runPgDump = (args: string[], extraEnv: Record<string, string>): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("pg_dump", args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
    });
  });

/** Borra los respaldos viejos según la retención. Nunca lanza. */
export const applyRetention = (dir: string, nowMs = Date.now()): string[] => {
  const deleted: string[] = [];
  try {
    const files = fs
      .readdirSync(dir)
      .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
    for (const name of selectBackupsToDelete(files, retentionFromEnv(), nowMs)) {
      try {
        fs.unlinkSync(path.join(dir, name));
        deleted.push(name);
      } catch (error) {
        logger.warn(`Backup retention: could not delete ${name}: ${error}`);
      }
    }
  } catch (error) {
    logger.warn(`Backup retention failed: ${error}`);
  }
  return deleted;
};

/** mtime del respaldo `daily` más reciente, o `null`. */
export const newestDailyBackupMtime = (dir: string): number | null => {
  try {
    let newest: number | null = null;
    for (const name of fs.readdirSync(dir)) {
      if (parseBackupName(name)?.reason !== "daily") continue;
      const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
      if (newest === null || mtime > newest) newest = mtime;
    }
    return newest;
  } catch {
    return null;
  }
};

/**
 * Genera un respaldo en `BACKUP_DIR` (`.tmp` + rename atómico) y aplica la
 * retención. Nunca lanza: devuelve `{ ok: false, error }`.
 */
export const runBackup = async (reason: BackupReason): Promise<BackupResult> => {
  const dir = process.env.BACKUP_DIR;
  const databaseUrl = process.env.DATABASE_URL;
  if (!dir) return { ok: false, error: "BACKUP_DIR is not set" };
  if (!databaseUrl) return { ok: false, error: "DATABASE_URL is not set" };

  let tmpFile: string | undefined;
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Restos de un respaldo interrumpido (apagón, kill): no son restaurables y ocupan disco.
    for (const f of fs.readdirSync(dir)) {
      if (/^cartas-.*\.dump\.tmp$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
    const name = backupFileName(new Date(), resolveTimezone(), reason);
    const finalFile = path.join(dir, name);
    tmpFile = `${finalFile}.tmp`;
    const command = buildPgDumpCommand(databaseUrl, tmpFile);
    await runPgDump(command.args, command.env);
    fs.renameSync(tmpFile, finalFile);
    tmpFile = undefined;
    const bytes = fs.statSync(finalFile).size;
    logger.info(`Backup (${reason}) written: ${name} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    const deleted = applyRetention(dir);
    if (deleted.length > 0) logger.info(`Backup retention removed ${deleted.length} old file(s)`);
    return { ok: true, file: finalFile, bytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Backup (${reason}) failed: ${message}`);
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
    return { ok: false, error: message };
  }
};
