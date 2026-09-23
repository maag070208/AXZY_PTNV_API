/**
 * Genera data de MOCK de control de acceso para desarrollo (pantallas
 * `/access` y `/access/report`): sitios con GPS en la zona del hotel y
 * eventos ENTRY/EXIT de los empleados reales del fixture a lo largo de los
 * últimos 14 días (incluido hoy). Cada jornada trae la entrada principal, una
 * salida final y varias salidas/entradas cortas (~15 min: "fui al Oxxo" /
 * "salí a fumar"), además de anomalías y anulaciones para que la bitácora y
 * el reporte muestren todos los estados.
 *
 * Uso:  npm run mock:access
 *
 * Seguridad: se niega a correr si `DATABASE_URL` no apunta a un host local.
 * Es idempotente: primero borra los eventos marcados como mock (deviceId
 * `MOCK-SEED-*`) y los sitios marcados `MOCK-*` los reutiliza (upsert por
 * nombre); volver a correrlo no duplica.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, type Site } from "@prisma/client";

// Carga api/.env (DATABASE_URL, …) — como hace `prisma db seed`.
import "dotenv/config";

const prisma = new PrismaClient();

// Offset de América/Mexico_City: UTC-6 fijo (sin DST desde 2022). Los horarios
// "de pared" se generan contra ese offset para que el reporte (que resuelve la
// ventana en esa zona) los atribuya al día correcto.
const TZ_OFFSET_HOURS = -6;

const DAYS_BACK = 14;

const MOCK_DEVICE_PREFIX = "MOCK-SEED-";

// Coordenadas base: zona de Puerto Nuevo, Baja California (litoral).
const BASE_LAT = 32.2415;
const BASE_LNG = -116.9341;

const SITES: Array<{
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}> = [
  { name: "Portería Principal", code: "PORT-PP", latitude: 32.2417, longitude: -116.9339, radiusMeters: 30 },
  { name: "Acceso Empleados", code: "PORT-AE", latitude: 32.2422, longitude: -116.9346, radiusMeters: 25 },
  { name: "Estacionamiento", code: "PORT-ES", latitude: 32.2406, longitude: -116.9358, radiusMeters: 60 },
  { name: "Zona de Servicio", code: "PORT-ZS", latitude: 32.2431, longitude: -116.9329, radiusMeters: 40 },
];

const VOID_REASONS = [
  "Registro duplicado por relectura del QR",
  "Horario incorrecto, se rehabilita el registro correcto",
  "Entrada cancelada por el responsable de área",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const chance = (p: number): boolean => Math.random() < p;

const randInt = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (max - min + 1));

/** Crea un Date UTC para un "hora de pared" en America/Mexico_City. */
const wallTime = (year: number, month: number, day: number, h: number, m: number): Date =>
  new Date(Date.UTC(year, month, day, h - TZ_OFFSET_HOURS, m, randInt(0, 59)));

function assertBaseDeDatosLocal() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  if (!isLocal && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("mock:access solo corre contra una base local (DATABASE_URL");
  }
}

async function upsertSites(): Promise<Site[]> {
  const out: Site[] = [];
  for (const s of SITES) {
    const site = await prisma.site.upsert({
      where: { code: s.code },
      update: {
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        radiusMeters: s.radiusMeters,
        active: true,
      },
      create: { ...s, active: true },
    });
    out.push(site);
  }
  return out;
}

async function main() {
  assertBaseDeDatosLocal();

  console.log("[mock:access] limpiando mocks previos (deviceId MOCK-SEED-*)…");
  const removed = await prisma.accessEvent.deleteMany({
    where: { deviceId: { startsWith: MOCK_DEVICE_PREFIX } },
  });
  console.log(`[mock:access] eventos mocks eliminados: ${removed.count}`);

  const sites = await upsertSites();

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true, name: true },
  });
  const guard = await prisma.user.findFirst({
    where: { role: "GUARD", active: true, username: { not: { contains: "E2E" } } },
    select: { id: true },
  });

  const employees = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["EMPLEADO", "JEFE_DE_AREA", "GERENTE"] },
      numeroEmpleado: { not: null },
    },
    select: { id: true, name: true, numeroEmpleado: true },
  });
  if (employees.length === 0) {
    throw new Error("No hay empleados con número en la base; corre el seed antes");
  }
  console.log(`[mock:access] empleados con data: ${employees.length} · sitios: ${sites.length}`);

  const now = new Date();
  const mkRecord = (i: number) => ({
    type: "MANUAL" as const,
    locationSource: "MANUAL" as const,
    method: "MANUAL" as const,
    clientEventId: randomUUID(),
    deviceId: `${MOCK_DEVICE_PREFIX}${i}`,
    notes: "[mock]",
  });

  let seq = 0;
  const rows: Array<{
    data: Parameters<typeof prisma.accessEvent.create>[0]["data"];
  }> = [];

  for (let back = DAYS_BACK; back >= 0; back--) {
    const base = new Date(now.getTime() - back * 86_400_000);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    const d = base.getUTCDate();
    const dow = base.getUTCDay();
    const isToday = back === 0;
    const isWeekend = dow === 0 || dow === 6;

    // Los empleados ordenados por id dan una distribución estable entre corridas.
    const shifted = [...employees].sort((a, b) => a.id.localeCompare(b.id));

    shifted.forEach((emp) => {
      // Días de semana: casi todos entran; fines de semana: solo un 25%.
      const presence =
        isWeekend && !isToday ? 0.25 : isToday ? 1 : 0.85;
      if (!chance(presence)) return;

      const site = pick(sites);
      const jitterLat = BASE_LAT + (Math.random() - 0.5) * 0.003;
      const jitterLng = BASE_LNG + (Math.random() - 0.5) * 0.003;
      const roll = Math.random();
      const locationSource =
        roll < 0.85 ? "GPS" : roll < 0.95 ? "SITE_ONLY" : "MANUAL";
      const method = chance(0.95) ? "QR_SCAN" : "MANUAL";
      const credentialVersion = randInt(1, 4);

      const madeEntry = chance(0.94);
      const WORKDAY_END = 20 * 60; // 20:00 (minutos desde medianoche)

      // Inserta un evento a una hora "de pared" (minutos desde medianoche).
      const push = (
        type: "ENTRY" | "EXIT",
        minuteOfDay: number,
        opts?: { notes?: string; method?: "QR_SCAN" | "MANUAL" }
      ) => {
        const h = Math.floor(minuteOfDay / 60);
        const m = minuteOfDay % 60;
        const at = wallTime(y, mo, d, h, m);
        seq += 1;
        rows.push({
          data: {
            ...mkRecord(seq),
            type,
            siteId: site.id,
            occurredAt: at,
            deviceTimestamp: at,
            employeeId: emp.id,
            employeeNameSnapshot: emp.name,
            employeeNumberSnapshot: emp.numeroEmpleado,
            guardId: guard?.id ?? admin?.id ?? null,
            latitude: locationSource === "GPS" ? jitterLat : site.latitude,
            longitude: locationSource === "GPS" ? jitterLng : site.longitude,
            gpsAccuracyMeters: locationSource === "GPS" ? randInt(5, 40) : null,
            locationSource,
            method: opts?.method ?? method,
            credentialVersion,
            scannedPayloadHash: `mock-${emp.id.slice(0, 8)}-${seq}`,
            deviceCode: `MOCK-${site.code}`,
            notes: opts?.notes ?? "[mock]",
          },
        });
      };

      // Sin entrada ese día: a veces aparece solo una salida (EXIT_WITHOUT_ENTRY).
      if (!madeEntry) {
        if (chance(0.05)) {
          push("EXIT", randInt(12 * 60, 18 * 60), {
            method: "MANUAL",
            notes: "[mock] salida sin entrada registrada",
          });
        }
        return;
      }

      // Entrada principal (6:20 → 8:40).
      let cursor = 6 * 60 + randInt(20, 160);
      push("ENTRY", cursor);

      // Anomalía deliberada: entra y nunca sale (ENTRY_WITHOUT_EXIT / OPEN_ENTRY).
      if (chance(isToday ? 0.18 : 0.05)) return;

      // Salidas/entradas cortas durante la jornada: el clásico "fui al Oxxo" o
      // "salí a fumar". Cada break es un EXIT seguido de un ENTRY ~15 min después
      // (5-20 min fuera), así el día queda con varias sesiones y sus huecos.
      const breaks = chance(0.8) ? randInt(1, 5) : 0;
      for (let i = 0; i < breaks; i++) {
        cursor += randInt(45, 150); // tramo trabajado de 45 min a 2.5 h
        if (cursor >= WORKDAY_END - 40) break;
        push("EXIT", cursor, { notes: "[mock] salida corta (Oxxo / cigarro)" });
        cursor += randInt(5, 20); // el break: ~15 min fuera
        if (cursor >= WORKDAY_END) break;
        push("ENTRY", cursor, { notes: "[mock] regreso de salida corta" });
      }

      // Salida final (15:00 → 19:30).
      cursor = Math.max(cursor + randInt(60, 240), randInt(15 * 60, 19 * 60 + 30));
      cursor = Math.min(cursor, WORKDAY_END);
      push("EXIT", cursor);
    });
  }

  // Aproximadamente 1 de cada 60 eventos queda anulado, repartido en el rango.
  const voidable = rows.filter((r) => r.data.clientEventId && r.data.clientEventId);
  for (const r of voidable) {
    if (chance(1 / 60)) {
      const occurredAt = r.data.occurredAt as Date;
      r.data.voidedAt = new Date(occurredAt.getTime() + randInt(30, 180) * 60_000);
      r.data.voidedById = admin?.id ?? null;
      r.data.voidReason = pick(VOID_REASONS);
    }
  }

  // Insert por lotes (individual no da problema, son ~1k filas).
  await prisma.accessEvent.createMany({
    data: rows.map((r) => r.data as never),
    skipDuplicates: false,
  });

  const count = await prisma.accessEvent.count({
    where: { deviceId: { startsWith: MOCK_DEVICE_PREFIX } },
  });
  const voided = await prisma.accessEvent.count({
    where: { deviceId: { startsWith: MOCK_DEVICE_PREFIX }, voidedAt: { not: null } },
  });
  console.log(`[mock:access] OK · ${count} eventos (${voided} anulados) · ${sites.length} sitios`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[mock:access] error:", err);
  await prisma.$disconnect();
  process.exit(1);
});