import { isBackupReason, BACKUP_REASONS } from "./backup.rules";
import { runBackup } from "./backup.service";

/** Uso: `node dist/src/core/backup/cli.js <daily|pre-migrate>`. Exit 0 = respaldo listo. */
const main = async (): Promise<void> => {
  const reason = process.argv[2];
  if (!isBackupReason(reason)) {
    console.error(`Usage: cli <${BACKUP_REASONS.join("|")}>`);
    process.exit(2);
  }
  const result = await runBackup(reason);
  process.exit(result.ok ? 0 : 1);
};

void main();
