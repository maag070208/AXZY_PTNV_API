import { logger } from "@core/utils/logger";
import { resolveTimezone } from "@core/utils/timezone";
import { env } from "@core/config/env.config";
import { isDailyBackupDue, msUntilNextHour } from "./backup.rules";
import { newestDailyBackupMtime, runBackup } from "./backup.service";

let running = false;
let timer: NodeJS.Timeout | null = null;

/** Una corrida a la vez; nunca lanza. */
const runDaily = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    await runBackup("daily");
  } catch (error) {
    logger.error(`Daily backup crashed: ${error}`);
  } finally {
    running = false;
  }
};

const scheduleNext = (): void => {
  const delay = msUntilNextHour(new Date(), env.BACKUP_HOUR, resolveTimezone());
  timer = setTimeout(() => {
    void runDaily().finally(scheduleNext);
  }, delay);
  timer.unref();
};

/**
 * Respaldo diario a `BACKUP_HOUR` (hora local) y uno al arrancar si el último
 * tiene más de 24 h. Solo en producción, con `BACKUP_DIR` y sin
 * `BACKUP_ENABLED=false`.
 */
export const startBackupScheduler = (): void => {
  if (timer) return;
  if (env.NODE_ENV !== "production" || !env.BACKUP_DIR || !env.BACKUP_ENABLED) return;
  if (isDailyBackupDue(newestDailyBackupMtime(env.BACKUP_DIR), Date.now())) void runDaily();
  scheduleNext();
  logger.info(`Automatic backups on: daily at ${env.BACKUP_HOUR}:00 -> ${env.BACKUP_DIR}`);
};
