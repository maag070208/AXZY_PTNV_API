import { E2E_PREFIX } from "./env";
import { db } from "./db";

/**
 * Siembra el timeline de sincronización de un reloj para las suites de
 * navegador: la base la posee `api/`, así que la web delega aquí (los intentos
 * los crea la sincronización real, y eso no se puede provocar sin un reloj).
 *
 * Deja un reloj `E2E-CHK-<run>-VIS` apuntando a un puerto cerrado, con tres
 * intentos: falló → conectó → volvió a fallar (el más reciente primero), que es
 * justo el caso que soporte necesita ver.
 */
export interface TimelineSeed {
  serial: string;
  name: string;
}

const serialOf = (runId: string): string => `${E2E_PREFIX}-CHK-${runId}-VIS`;
const nombreOf = (runId: string): string => `E2E Timeline ${runId}`;
const CAIDA = "connect ECONNREFUSED 127.0.0.1:9";

const evento = (
  serial: string,
  ok: boolean,
  minutesAgo: number
): { clockSerial: string; trigger: string; ok: boolean; startedAt: Date; finishedAt: Date; readCount: number; newCount: number; lastSerialNo: number | null; error: string | null } => {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  return {
    clockSerial: serial,
    trigger: "AUTO",
    ok,
    startedAt: at,
    finishedAt: at,
    readCount: ok ? 24 : 0,
    newCount: ok ? 7 : 0,
    lastSerialNo: ok ? 4_321 : null,
    error: ok ? null : CAIDA,
  };
};

export const seedClockTimeline = async (runId: string): Promise<TimelineSeed> => {
  const serial = serialOf(runId);
  const name = nombreOf(runId);

  await db.timeClockSyncEvent.deleteMany({ where: { clockSerial: serial } });
  await db.timeClock.upsert({
    where: { serialNumber: serial },
    create: { serialNumber: serial, name, url: "http://127.0.0.1:9", countsAttendance: true },
    update: { name, url: "http://127.0.0.1:9" },
  });
  await db.timeClockSyncEvent.createMany({
    data: [evento(serial, false, 30), evento(serial, true, 20), evento(serial, false, 10)],
  });

  return { serial, name };
};

export const cleanClockTimeline = async (runId: string): Promise<number> => {
  const serial = serialOf(runId);
  // La FK va con `onDelete: Cascade`, pero se borran explícitos por claridad.
  await db.timeClockSyncEvent.deleteMany({ where: { clockSerial: serial } });
  const { count } = await db.timeClock.deleteMany({ where: { serialNumber: serial } });
  return count;
};
