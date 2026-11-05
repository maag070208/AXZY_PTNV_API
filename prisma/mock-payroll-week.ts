/**
 * Genera checadas de EJEMPLO para la plantilla REAL (todos los departamentos)
 * de la semana vigente, para revisar la pre-nómina con datos en pantalla.
 *
 * - Universo: usuarios activos con rol staff y vínculo al reloj
 *   (`time_clock_employees`), EXCEPTO la data demo (`demo.*` / `DEMO-`,
 *   que ya genera `mock:attendance`). Quien no tiene vínculo se salta (en el
 *   reporte aparece "Sin vínculo", como en la vida real).
 * - Las checadas se escriben en un reloj mock propio (`MOCK-CLOCK-ALL`) para
 *   NO tocar los relojes reales ni su cursor de sincronización.
 * - Horario por persona: el asignado (`schedule_assignments`); sin horario se
 *   genera 08:00–16:00 con descanso sábado/domingo.
 * - Casos con probabilidad modesta: falta ~5 %, retardo ~8 %, tiempo extra
 *   ~20 % (40–120 min), entrada sin salida ~3 %.
 *
 * Uso:  npm run mock:payroll            (genera; idempotente)
 *       npm run mock:payroll -- --clean (solo borra la data generada)
 *
 * Seguridad: solo corre contra una base local. Todo lo que crea se reconoce
 * por el reloj `MOCK-CLOCK-ALL` y se borra antes de volver a generar.
 */
import "dotenv/config";
import { PrismaClient, type PunchMethod } from "@prisma/client";
import {
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  resolveWeekStartWithConfig,
  startOfLocalDay,
} from "@core/utils/timezone";
import { loadRolesFromDb, staffRoleKeys } from "@core/permissions";
import { loadScheduleAssignments, scheduleOn } from "@modules/schedules/services/schedule-assignments";
import { toMinutes, toUtcDate, weekdayOf } from "@modules/schedules/services/workday-rules";

const prisma = new PrismaClient();

const CLOCK_SERIAL = "MOCK-CLOCK-ALL";
const CLOCK_NAME = "Reloj mock (toda la plantilla)";
const DEMO_USERNAME_PREFIX = "demo.";
const DEMO_NUMBER_PREFIX = "DEMO-";

/** Horario de quien no tiene uno asignado (solo para generar sus checadas). */
const FALLBACK = { start: "08:00", end: "16:00", restDays: [6, 7] };

const ABSENCE_P = 0.05;
const LATE_P = 0.08;
const OVERTIME_P = 0.2;
const MISSING_EXIT_P = 0.03;

// PRNG con semilla: la misma corrida da los mismos casos (fácil de comparar).
let seed = 20261104;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => random() < p;
const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));

const METHODS: PunchMethod[] = ["FACE", "FACE", "FACE", "FINGERPRINT", "CARD"];
const MINOR: Record<PunchMethod, number> = { FACE: 75, FINGERPRINT: 38, CARD: 1, OTHER: 104 };

const addDays = (dayKey: string, days: number) => {
  const d = toUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("mock:payroll only runs against a local database (DATABASE_URL)");
  }
}

async function clean() {
  const punches = await prisma.timeClockPunch.deleteMany({ where: { clockSerial: CLOCK_SERIAL } });
  await prisma.timeClock.deleteMany({ where: { serialNumber: CLOCK_SERIAL } });
  console.log(`Borrado: ${punches.count} checadas del reloj ${CLOCK_SERIAL}.`);
}

async function main() {
  assertLocalDatabase();
  await clean();
  if (process.argv.includes("--clean")) return;

  // Misma zona y primer día de semana que los reportes (sys_config → env → default).
  const sysConfig = async (key: string) => (await prisma.sysConfig.findUnique({ where: { key } }))?.value ?? null;
  const tz = await resolveTimezoneWithConfig(undefined, sysConfig);
  const weekStart = await resolveWeekStartWithConfig(sysConfig);
  const today = localDateKey(new Date(), tz);
  const range = resolveReportRange("WEEK", today, tz, weekStart);
  const firstDay = localDateKey(range.start, tz);
  const now = Date.now();

  await loadRolesFromDb(prisma);

  const people = await prisma.user.findMany({
    where: {
      role: { in: staffRoleKeys() },
      active: true,
      username: { not: { startsWith: DEMO_USERNAME_PREFIX } },
      timeClockEmployees: { some: { employeeNumber: { not: { startsWith: DEMO_NUMBER_PREFIX } } } },
    },
    select: {
      id: true,
      name: true,
      department: { select: { name: true } },
      timeClockEmployees: { select: { employeeNumber: true } },
    },
    orderBy: { name: "asc" },
  });
  const staff = people
    .map((p) => ({
      userId: p.id,
      name: p.name,
      department: p.department?.name ?? "—",
      // El número del reloj vinculado (el real, con el prefijo de área si lo trae).
      clockNumber: p.timeClockEmployees.find((t) => !t.employeeNumber.startsWith(DEMO_NUMBER_PREFIX))!.employeeNumber,
    }))
    // Un número de reloj solo puede pertenecer a una persona: dedup por si acaso.
    .filter((p, i, all) => all.findIndex((x) => x.clockNumber === p.clockNumber) === i);

  if (staff.length === 0) {
    console.log("No hay personal activo con vínculo al reloj (fuera de la data demo); no se generó nada.");
    return;
  }

  const assignments = await loadScheduleAssignments(prisma, staff.map((p) => p.userId), {
    start: toUtcDate(addDays(firstDay, -7)),
    end: toUtcDate(addDays(today, 2)),
  });

  await prisma.timeClock.create({
    data: { serialNumber: CLOCK_SERIAL, name: CLOCK_NAME, url: null, countsAttendance: true, model: "MOCK" },
  });

  const punches: Array<{ employeeNumber: string; name: string; occurredAt: Date }> = [];
  let absences = 0;

  for (const person of staff) {
    for (let day = firstDay; day <= today; day = addDays(day, 1)) {
      const schedule = scheduleOn(assignments, person.userId, day);
      const scheduledDay = schedule?.days.find((d) => d.weekday === weekdayOf(day)) ?? null;

      let rest: boolean;
      let startMin: number;
      let endMin: number;
      if (schedule && scheduledDay) {
        rest = scheduledDay.restDay || !scheduledDay.startTime || !scheduledDay.endTime;
        startMin = toMinutes(scheduledDay.startTime);
        endMin = toMinutes(scheduledDay.splitEndTime ?? scheduledDay.endTime);
        if (endMin <= startMin) endMin += 24 * 60; // turno nocturno: sale al día siguiente
      } else {
        rest = FALLBACK.restDays.includes(weekdayOf(day));
        startMin = toMinutes(FALLBACK.start);
        endMin = toMinutes(FALLBACK.end);
      }
      // Descanso: no se generan checadas (el mock no simula descanso trabajado).
      if (rest) continue;
      if (chance(ABSENCE_P)) {
        absences += 1;
        continue;
      }

      const dayStart = startOfLocalDay(day, tz).getTime();
      const at = (minutes: number) => new Date(dayStart + minutes * 60_000 + between(0, 59) * 1000);
      const entry = startMin + (chance(LATE_P) ? between(15, 55) : between(-12, 6));
      const exit = endMin + (chance(OVERTIME_P) ? between(40, 120) : between(-4, 9));
      const add = (minutes: number) => {
        const occurredAt = at(minutes);
        if (occurredAt.getTime() <= now) punches.push({ employeeNumber: person.clockNumber, name: person.name, occurredAt });
      };

      add(entry);
      if (!chance(MISSING_EXIT_P)) add(exit);
    }
  }

  punches.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  await prisma.timeClockPunch.createMany({
    data: punches.map((c, i) => {
      const method = METHODS[between(0, METHODS.length - 1)];
      return { ...c, clockSerial: CLOCK_SERIAL, serialNo: i + 1, method, minor: MINOR[method] };
    }),
  });
  await prisma.timeClock.update({ where: { serialNumber: CLOCK_SERIAL }, data: { lastSerialNo: punches.length, syncedAt: new Date() } });

  const departments = [...new Set(staff.map((p) => p.department))].sort();
  console.log(
    `Listo: ${staff.length} personas de ${departments.length} departamentos, ${punches.length} checadas del ${firstDay} al ${today} (${tz}), ` +
      `${absences} faltas generadas. Reloj mock: ${CLOCK_SERIAL}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
