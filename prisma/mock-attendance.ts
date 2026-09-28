/**
 * Genera data de EJEMPLO de asistencia para desarrollo (pantallas de horas
 * extra, entradas/salidas del reloj y el reporte semanal de RH): un
 * departamento demo con 8 empleados vinculados al reloj, sus horarios y cinco
 * semanas de checadas (hasta hoy) con todos los casos que el reporte distingue:
 *
 * - jornada normal y hora extra (se queda después de su salida)
 * - llegadas tarde y faltas (día laboral sin checadas)
 * - turno nocturno que cruza la medianoche (23:00 → 07:00)
 * - entrada sin salida (una sola checada) y checadas repetidas del reloj
 * - día de descanso trabajado
 * - una persona sin horario asignado (el cálculo cae a 8 h)
 *
 * Además aprueba y rechaza algunos días de tiempo extra de las semanas pasadas,
 * para ver "aprobado" contra "no aprobado".
 *
 * Uso:  npm run mock:attendance            (genera; idempotente)
 *       npm run mock:attendance -- --clean (solo borra la data de ejemplo)
 *
 * Seguridad: solo corre contra una base local. Todo lo que crea está marcado
 * (departamento `RECEPCIÓN DEMO`, usuarios `demo.*`, reloj `DEMO-CLOCK-01`,
 * horarios `DEMO *`) y se borra antes de volver a generar.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient, type PunchMethod } from "@prisma/client";
import { hashPassword } from "@core/utils/security";
import { localDateKey, resolveTimezoneWithConfig, startOfLocalDay } from "@core/utils/timezone";
import { createSchedulesModule } from "@modules/schedules";
import { OvertimeService } from "@modules/overtime/services/overtime.service";

const prisma = new PrismaClient();

const DEPARTMENT = "RECEPCIÓN DEMO";
const CLOCK_SERIAL = "DEMO-CLOCK-01";
const USERNAME_PREFIX = "demo.";
const NUMBER_PREFIX = "DEMO-";
const SCHEDULE_PREFIX = "DEMO ";
const WEEKS = 5;

// PRNG con semilla: la misma corrida da los mismos casos (fácil de comparar).
let seed = 20260928;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => random() < p;
const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));

type ScheduleKey = "MORNING" | "EVENING" | "NIGHT";

/** Horarios demo: weekday 1 = lunes … 7 = domingo. */
const SCHEDULES: Record<ScheduleKey, { name: string; start: string; end: string; restDays: number[]; crossesMidnight: boolean }> = {
  MORNING: { name: `${SCHEDULE_PREFIX}Matutino 07-15`, start: "07:00", end: "15:00", restDays: [7], crossesMidnight: false },
  EVENING: { name: `${SCHEDULE_PREFIX}Vespertino 15-23`, start: "15:00", end: "23:00", restDays: [2], crossesMidnight: false },
  NIGHT: { name: `${SCHEDULE_PREFIX}Nocturno 23-07`, start: "23:00", end: "07:00", restDays: [7], crossesMidnight: true },
};

/** Perfil de cada empleado: qué casos le tocan y con qué frecuencia. */
interface Profile {
  number: string;
  name: string;
  paternalSurname: string;
  maternalSurname: string;
  jobTitle: string;
  schedule: ScheduleKey | null;
  absence: number;
  late: number;
  overtime: number;
  missingExit: number;
  duplicate: number;
  restDayWork: number;
}

const PROFILES: Profile[] = [
  { number: "657", name: "RAÚL", paternalSurname: "ORTEGA", maternalSurname: "BRAVO", jobTitle: "Recepcionista", schedule: "MORNING", absence: 0.02, late: 0.05, overtime: 0.15, missingExit: 0, duplicate: 0.05, restDayWork: 0 },
  { number: "722", name: "LUCÍA", paternalSurname: "PEÑA", maternalSurname: "SOTO", jobTitle: "Recepcionista", schedule: "MORNING", absence: 0.2, late: 0.1, overtime: 0.05, missingExit: 0.03, duplicate: 0, restDayWork: 0 },
  { number: "792", name: "JOSÉ MANUEL", paternalSurname: "IBARRA", maternalSurname: "LUNA", jobTitle: "Capitán de botones", schedule: "MORNING", absence: 0.02, late: 0.03, overtime: 0.6, missingExit: 0, duplicate: 0.05, restDayWork: 0.3 },
  { number: "851", name: "IRMA", paternalSurname: "CASTRO", maternalSurname: "VEGA", jobTitle: "Recepcionista", schedule: "EVENING", absence: 0.04, late: 0.45, overtime: 0.1, missingExit: 0, duplicate: 0, restDayWork: 0 },
  { number: "872", name: "DANIELA", paternalSurname: "RUIZ", maternalSurname: "MORA", jobTitle: "Auditora nocturna", schedule: "EVENING", absence: 0.03, late: 0.05, overtime: 0.45, missingExit: 0, duplicate: 0.1, restDayWork: 0.5 },
  { number: "888", name: "GUSTAVO", paternalSurname: "SALAZAR", maternalSurname: "RÍOS", jobTitle: "Auditor nocturno", schedule: "NIGHT", absence: 0.04, late: 0.08, overtime: 0.3, missingExit: 0.03, duplicate: 0, restDayWork: 0 },
  { number: "911", name: "ALBERTO", paternalSurname: "NAVARRO", maternalSurname: "DÍAZ", jobTitle: "Botones", schedule: "EVENING", absence: 0.05, late: 0.1, overtime: 0.1, missingExit: 0.2, duplicate: 0.25, restDayWork: 0 },
  // Sin horario asignado: el cálculo de horas extra usa la jornada por defecto.
  { number: "930", name: "SOFÍA", paternalSurname: "MÉNDEZ", maternalSurname: "CRUZ", jobTitle: "Concierge", schedule: null, absence: 0.05, late: 0.05, overtime: 0.2, missingExit: 0, duplicate: 0, restDayWork: 0 },
];

/** Horario de quien no tiene uno asignado (solo para generar sus checadas). */
const UNSCHEDULED = { start: "08:00", end: "16:00", restDays: [6, 7] };

const METHODS: PunchMethod[] = ["FACE", "FACE", "FACE", "FINGERPRINT", "CARD"];
const MINOR: Record<PunchMethod, number> = { FACE: 75, FINGERPRINT: 38, CARD: 1, OTHER: 104 };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const isoWeekday = (dayKey: string) => {
  const js = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
};
const addDays = (dayKey: string, days: number) => {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fullName = (p: Profile) => `${p.name} ${p.paternalSurname} ${p.maternalSurname}`;

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("mock:attendance only runs against a local database (DATABASE_URL)");
  }
}

async function clean() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const punches = await prisma.timeClockPunch.deleteMany({ where: { clockSerial: CLOCK_SERIAL } });
  await prisma.timeClockEmployee.deleteMany({ where: { employeeNumber: { startsWith: NUMBER_PREFIX } } });
  await prisma.overtimeApproval.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.scheduleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.schedule.deleteMany({ where: { name: { startsWith: SCHEDULE_PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.timeClock.deleteMany({ where: { serialNumber: CLOCK_SERIAL } });
  await prisma.department.deleteMany({ where: { name: DEPARTMENT } });
  console.log(`Borrado: ${userIds.length} empleados demo, ${punches.count} checadas.`);
}

async function main() {
  assertLocalDatabase();
  await clean();
  if (process.argv.includes("--clean")) return;

  // Misma zona y semana que los reportes (sys_config → env → default).
  const sysConfig = async (key: string) => (await prisma.sysConfig.findUnique({ where: { key } }))?.value ?? null;
  const tz = await resolveTimezoneWithConfig(undefined, sysConfig);
  const today = localDateKey(new Date(), tz);
  const firstDay = addDays(today, -(WEEKS * 7 - 1));
  const now = Date.now();

  const department = await prisma.department.create({ data: { name: DEPARTMENT } });
  await prisma.timeClock.create({
    data: { serialNumber: CLOCK_SERIAL, name: "Reloj demo (recepción)", url: null, countsAttendance: true, model: "DEMO" },
  });

  const schedules = {} as Record<ScheduleKey, string>;
  for (const [key, s] of Object.entries(SCHEDULES) as Array<[ScheduleKey, (typeof SCHEDULES)[ScheduleKey]]>) {
    const created = await prisma.schedule.create({
      data: {
        name: s.name,
        crossesMidnight: s.crossesMidnight,
        entryToleranceMin: 10,
        exitToleranceMin: 10,
        minOvertimeMin: 30,
        days: {
          create: [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
            s.restDays.includes(weekday)
              ? { weekday, restDay: true }
              : { weekday, startTime: s.start, endTime: s.end, restDay: false }
          ),
        },
      },
    });
    schedules[key] = created.id;
  }

  // Nadie entra con esta cuenta: contraseña aleatoria.
  const password = await hashPassword(randomUUID());
  const punches: Array<{ employeeNumber: string; name: string; occurredAt: Date }> = [];
  const people: Array<{ userId: string; profile: Profile }> = [];

  for (const p of PROFILES) {
    const clockNumber = `${NUMBER_PREFIX}${p.number}`;
    const user = await prisma.user.create({
      data: {
        username: `${USERNAME_PREFIX}${p.number}`,
        password,
        name: fullName(p),
        paternalSurname: p.paternalSurname,
        maternalSurname: p.maternalSurname,
        role: "EMPLOYEE",
        jobTitle: p.jobTitle,
        employeeNumber: clockNumber,
        departmentId: department.id,
      },
    });
    people.push({ userId: user.id, profile: p });
    await prisma.timeClockEmployee.create({ data: { employeeNumber: clockNumber, userId: user.id } });
    if (p.schedule) {
      await prisma.scheduleAssignment.create({
        data: { userId: user.id, scheduleId: schedules[p.schedule], validFrom: new Date(`${addDays(firstDay, -7)}T00:00:00.000Z`) },
      });
    }

    const shift = p.schedule ? SCHEDULES[p.schedule] : UNSCHEDULED;
    const start = toMinutes(shift.start);
    let end = toMinutes(shift.end);
    if (end <= start) end += 24 * 60; // turno nocturno: sale al día siguiente

    for (let day = firstDay; day <= today; day = addDays(day, 1)) {
      const rest = shift.restDays.includes(isoWeekday(day));
      if (rest ? !chance(p.restDayWork) : chance(p.absence)) continue;

      const dayStart = startOfLocalDay(day, tz).getTime();
      const at = (minutes: number) => new Date(dayStart + minutes * 60_000 + between(0, 59) * 1000);
      const entry = start + (chance(p.late) ? between(15, 55) : between(-12, 6));
      const exit = end + (chance(p.overtime) ? between(40, 170) : between(-4, 9));
      const add = (minutes: number) => {
        const occurredAt = at(minutes);
        if (occurredAt.getTime() <= now) punches.push({ employeeNumber: clockNumber, name: fullName(p), occurredAt });
      };

      add(entry);
      // El reloj a veces registra dos veces la misma persona en pocos minutos.
      if (chance(p.duplicate)) add(entry + between(1, 3));
      if (!chance(p.missingExit)) add(exit);
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

  // Decisiones de tiempo extra en las semanas pasadas (la actual queda pendiente),
  // con el mismo servicio que usa la pantalla de aprobación.
  const { service: schedulesService } = createSchedulesModule({ sysConfig });
  const overtime = new OvertimeService(prisma, schedulesService);
  const demoIds = new Set(people.map((x) => x.userId));
  const approved: Array<{ userId: string; date: string }> = [];
  const rejected: Array<{ userId: string; date: string }> = [];
  for (let week = WEEKS - 1; week >= 1; week--) {
    const filters = { period: "WEEK", date: addDays(today, -week * 7), departmentId: department.id };
    const { data } = await overtime.query({ page: 1, limit: 1000, filters, sort: undefined });
    for (const row of data.filter((r) => demoIds.has(r.userId) && r.extraMin > 0)) {
      if (chance(0.55)) approved.push({ userId: row.userId, date: row.date });
      else if (chance(0.25)) rejected.push({ userId: row.userId, date: row.date });
    }
  }
  const decide = async (items: typeof approved, status: "APPROVED" | "REJECTED", note: string) => {
    for (const item of items) {
      await overtime.decide({
        items: [item],
        status,
        note,
        filters: { period: "DAY", date: item.date, departmentId: department.id },
      });
    }
  };
  await decide(approved, "APPROVED", "Autorizado por jefe de área (demo)");
  await decide(rejected, "REJECTED", "No autorizado: no se solicitó (demo)");

  console.log(
    `Listo: ${people.length} empleados en "${DEPARTMENT}", ${punches.length} checadas del ${firstDay} al ${today} (${tz}), ` +
      `${approved.length} días de tiempo extra aprobados y ${rejected.length} rechazados.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
