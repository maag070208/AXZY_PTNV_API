import bcrypt from "bcryptjs";
import { db } from "./db";
import { E2E, E2E_PREFIX } from "./env";

/**
 * Siembra para las suites de navegador del tiempo extra (`web/tests/e2e`).
 *
 * Las checadas SOLO entran por la sincronización con el reloj, que la suite no
 * dispara; por eso se siembran aquí, con Prisma, en el paquete `api/` (dueño de
 * la base). La zona es la del navegador de la suite (`America/Mazatlan`), para
 * que las checadas caigan en el día/semana que muestra la pantalla.
 *
 * Se invoca desde la CLI: `ts-node tests/e2e/support/cli.ts seed-overtime <runId>`.
 */
const TZ = "America/Mazatlan";

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
  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
    instant
  );
};

/** Instante UTC de una hora de pared en `tz`. */
const zonedTimeToUtc = (dateKey: string, hour: number, tz: string): Date => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz));
};

/** Día local `YYYY-MM-DD` de "hoy" en `tz`. */
const todayKey = (tz: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export interface OvertimeSeedUser {
  id: string;
  name: string;
  number: string;
  date: string;
  role: string;
  username: string;
}

export interface OvertimeSeedResult {
  users: OvertimeSeedUser[];
}

const serialOf = (runId: string): string => `${E2E_PREFIX}-WEBOT-${runId}`;
const scheduleOf = (runId: string): string => `E2E Web OT ${runId}`;
const userOf = (runId: string): string => `e2e_web_ot_${runId}`.toLowerCase();

/** Borra lo que haya sembrado una corrida previa con el mismo `runId`. */
export const cleanOvertimeWeb = async (runId: string): Promise<number> => {
  const users = await db.user.findMany({
    where: { username: { startsWith: userOf(runId) } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  await db.timeClockPunch.deleteMany({ where: { clockSerial: serialOf(runId) } });
  if (userIds.length) {
    await db.overtimeApproval.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.timeClockEmployee.deleteMany({ where: { userId: { in: userIds } } });
    await db.scheduleAssignment.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.schedule.deleteMany({ where: { name: { startsWith: scheduleOf(runId) } } });
  return userIds.length;
};

/**
 * Crea dos personas (A y B) con horario 08:00–17:00 (sin tolerancia de salida),
 * vínculo reloj ↔ usuario y checadas de hoy 08:00 → 19:00: cada una acumula
 * 120 min de tiempo extra PENDIENTE. Además crea una cuenta RH y otra JEFE (con
 * la contraseña de la suite) para probar el gate por rol.
 */
export const seedOvertimeWeb = async (runId: string): Promise<OvertimeSeedResult> => {
  await cleanOvertimeWeb(runId);
  const date = todayKey(TZ);
  const password = await bcrypt.hash(E2E.password, 10);

  const schedule = await db.schedule.create({
    data: {
      name: scheduleOf(runId),
      exitToleranceMin: 0,
      mealBreakMin: 0,
      days: {
        create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          restDay: false,
          startTime: "08:00",
          endTime: "17:00",
        })),
      },
    },
    select: { id: true },
  });

  const users: OvertimeSeedUser[] = [];
  let serial = 0;
  for (const suffix of ["A", "B"]) {
    const username = `${userOf(runId)}_${suffix.toLowerCase()}`;
    const name = `E2E Web OT ${runId} ${suffix}`;
    const user = await db.user.create({
      data: { username, name, role: "EMPLOYEE", active: true, password },
      select: { id: true },
    });
    const number = `${E2E_PREFIX}WEBOT${runId}${suffix}`;
    await db.timeClockEmployee.create({ data: { employeeNumber: number, userId: user.id } });
    await db.scheduleAssignment.create({
      // `desde` va como UTC-medianoche de la clave del día (mismo criterio que
      // `HorarioService.asignarMasivo` / `toUtcDate`), no como medianoche local.
      data: { userId: user.id, scheduleId: schedule.id, validFrom: new Date(`${date}T00:00:00.000Z`) },
    });
    for (const hour of [8, 19]) {
      await db.timeClockPunch.create({
        data: {
          clockSerial: serialOf(runId),
          serialNo: ++serial,
          employeeNumber: number,
          name: name,
          method: "FACE",
          minor: 75,
          occurredAt: zonedTimeToUtc(date, hour, TZ),
        },
      });
    }
    users.push({ id: user.id, name, number, date, role: "EMPLOYEE", username });
  }

  // Cuentas de rol para el gate de la ruta de aprobación (sin checadas).
  for (const [suffix, role] of [
    ["rh", "HUMAN_RESOURCES"],
    ["head", "AREA_HEAD"],
  ] as const) {
    const username = `${userOf(runId)}_${suffix}`;
    const name = `E2E Web OT ${runId} ${suffix.toUpperCase()}`;
    const user = await db.user.create({
      data: { username, name, role, active: true, password },
      select: { id: true },
    });
    users.push({ id: user.id, name, number: "", date, role, username });
  }

  return { users };
};
