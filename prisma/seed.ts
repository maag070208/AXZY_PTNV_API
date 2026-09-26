import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { seedPermissionsFromFixtures } from "../src/core/permissions/fixtures";
import { resolveSeedDataDir } from "../src/core/utils/seed-data-dir";

const prisma = new PrismaClient();

const DATA_DIR = resolveSeedDataDir(__dirname);

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

function reviveDates(value: any): any {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveDates(v);
    return out;
  }
  if (typeof value === "string" && DATE_RE.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }
  return value;
}

function loadFixture<T = any>(table: string): T[] {
  const file = path.join(DATA_DIR, `${table}.json`);
  const raw = fs.readFileSync(file, "utf-8");
  return reviveDates(JSON.parse(raw));
}

const GENDERS = ["Masculino", "Femenino", "Otro", "Prefiere no decir"];

const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

// Categorías de ticket (antes enum TicketCategory). El nombre coincide con el
// que inserta la migración `ticket_category_catalog`.
const TICKET_CATEGORIES = ["Mantenimiento", "Equipo", "Sistema", "Otro"];

// Mapea el valor del enum viejo (en los fixtures) al nombre del catálogo.
// Llaves: valores de la columna `category` del respaldo viejo (datos).
const CATEGORY_ENUM_TO_NAME: Record<string, string> = {
  "MANTENIMIENTO": "Mantenimiento",
  "EQUIPO": "Equipo",
  "SISTEMA": "Sistema",
  "OTRO": "Otro",
};

const DOCUMENT_TYPES = [
  "INE (Frente)",
  "INE (Reverso)",
  "CURP",
  "Acta de Nacimiento",
  "Comprobante de Domicilio",
  "RFC / Constancia de Situación Fiscal",
  "NSS / Alta IMSS",
  "Contrato Laboral",
  "Curriculum Vitae",
  "Comprobante de Estudios",
  "Fotografía",
  "Carta de Recomendación",
  "Solicitud de Empleo",
  "Acta de Matrimonio",
  "Cartilla Militar",
  "Antecedentes No Penales",
  "Licencia de Conducir",
  "Datos Bancarios (CLABE)",
];

// Catálogos de Recursos Humanos: se siembran siempre (upsert por nombre), sin
// importar si el resto del seed se omite por ya tener datos, para que el
// catálogo de tipos de documento exista desde el primer arranque.
async function seedHrCatalogs() {
  for (const name of GENDERS) {
    await prisma.gender.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of BLOOD_TYPES) {
    await prisma.bloodType.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const [sortOrder, name] of DOCUMENT_TYPES.entries()) {
    await prisma.documentType.upsert({
      where: { name },
      update: { sortOrder },
      create: { name, sortOrder },
    });
  }
  for (const name of TICKET_CATEGORIES) {
    await prisma.ticketCategory.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(
    `Catálogos RH listos: ${GENDERS.length} géneros, ${BLOOD_TYPES.length} tipos de sangre, ${DOCUMENT_TYPES.length} tipos de documento, ${TICKET_CATEGORIES.length} categorías de ticket`
  );
}

// Horarios de ejemplo (módulo de administración). Se siembran por nombre si no
// existen, para que el módulo de horarios tenga catálogo desde el arranque.
type SeedScheduleDay = {
  weekday: number;
  startTime?: string;
  endTime?: string;
  splitStartTime?: string;
  splitEndTime?: string;
  restDay?: boolean;
};

/** Lunes–viernes con la misma jornada; sábado/domingo configurables. */
function week(
  startTime: string,
  endTime: string,
  opts: {
    sat?: [string, string];
    dom?: [string, string] | "rest";
    split?: [string, string];
  } = {}
): SeedScheduleDay[] {
  const out: SeedScheduleDay[] = [];
  for (let d = 1; d <= 5; d++) {
    out.push({
      weekday: d,
      startTime,
      endTime,
      splitStartTime: opts.split?.[0],
      splitEndTime: opts.split?.[1],
    });
  }
  out.push({
    weekday: 6,
    startTime: opts.sat?.[0] ?? startTime,
    endTime: opts.sat?.[1] ?? endTime,
    splitStartTime: opts.split?.[0],
    splitEndTime: opts.split?.[1],
  });
  const dom = opts.dom ?? "rest";
  if (dom === "rest") out.push({ weekday: 7, restDay: true });
  else out.push({ weekday: 7, startTime: dom[0], endTime: dom[1] });
  return out;
}

const SEED_SCHEDULES: Array<{
  name: string;
  mealBreakMin?: number;
  crossesMidnight?: boolean;
  days: SeedScheduleDay[];
}> = [
  { name: "Matutino", mealBreakMin: 30, days: week("08:00", "16:00", { sat: ["08:00", "14:00"] }) },
  { name: "Vespertino", mealBreakMin: 30, crossesMidnight: true, days: week("16:00", "00:00", { sat: ["14:00", "22:00"] }) },
  { name: "Nocturno", mealBreakMin: 30, crossesMidnight: true, days: week("22:00", "06:00") },
  { name: "Desayunos", mealBreakMin: 30, days: week("06:00", "14:00") },
  { name: "Restaurante (mixto)", mealBreakMin: 30, days: week("12:00", "20:00", { dom: ["12:00", "18:00"] }) },
  { name: "Camaristas (turno partido)", mealBreakMin: 0, days: week("08:00", "13:00", { split: ["16:00", "20:00"] }) },
  { name: "Centro de consumo (partido)", mealBreakMin: 0, days: week("10:00", "14:00", { split: ["17:00", "21:00"] }) },
  { name: "Administrativo", mealBreakMin: 60, days: week("09:00", "18:00") },
  {
    name: "Guardia (12 h)",
    mealBreakMin: 0,
    crossesMidnight: true,
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: "19:00", endTime: "07:00" })),
  },
  { name: "Medio turno (S)", mealBreakMin: 0, days: week("08:00", "12:00") },
];

async function seedSchedules() {
  let created = 0;
  for (const h of SEED_SCHEDULES) {
    const exists = await prisma.schedule.findUnique({ where: { name: h.name } });
    if (exists) continue;
    await prisma.schedule.create({
      data: {
        name: h.name,
        entryToleranceMin: 10,
        exitToleranceMin: 10,
        mealBreakMin: h.mealBreakMin ?? 0,
        crossesMidnight: h.crossesMidnight ?? false,
        days: {
          create: h.days.map((d) => ({
            weekday: d.weekday,
            restDay: d.restDay ?? false,
            startTime: d.restDay ? null : d.startTime ?? null,
            endTime: d.restDay ? null : d.endTime ?? null,
            splitStartTime: d.restDay ? null : d.splitStartTime ?? null,
            splitEndTime: d.restDay ? null : d.splitEndTime ?? null,
          })),
        },
      },
    });
    created += 1;
  }
  console.log(`Horarios listos: ${created} nuevos (${SEED_SCHEDULES.length} en el catálogo)`);
}

async function main() {
  await seedHrCatalogs();
  await seedSchedules();

  // Catálogo y matriz de permisos: insert-missing desde los fixtures, para que
  // corra también en bases ya sembradas (no pisa ediciones).
  await seedPermissionsFromFixtures(prisma);
  console.log("Catálogo y matriz de permisos listos (fixtures)");

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    // `20260917195258_inventario_model` borra el inventario del modelo viejo.
    // Si quedan usuarios pero ni un tipo de dispositivo, es que esa migración
    // ya corrió y el respaldo nunca se cargó: la base quedó a medias. Se corta
    // aquí en vez de arrancar sirviendo un inventario vacío.
    const types = await prisma.deviceType.count();
    if (types === 0) {
      throw new Error(
        `La base tiene ${existingUsers} usuarios pero el inventario está vacío: la migración ` +
          `eliminó el modelo viejo y el respaldo todavía no se carga. Corre el corte con ` +
          `\`npm run cutover\`, que reemplaza la base con el respaldo de prisma/seed-data.`
      );
    }
    console.log(`Seed omitido: la BD ya tiene ${existingUsers} usuarios.`);
    return;
  }

  // ---------------------------------------------------------------------------
  // Reset (hijos antes que padres).
  // ---------------------------------------------------------------------------
  await prisma.auditLog.deleteMany({});
  await prisma.ticketAttachment.deleteMany({});
  await prisma.ticketAssignmentComment.deleteMany({});
  await prisma.ticketAssignment.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.loanReturnItemUnit.deleteMany({});
  await prisma.loanReturnItem.deleteMany({});
  await prisma.loanReturn.deleteMany({});
  await prisma.loanItemUnit.deleteMany({});
  await prisma.loanItem.deleteMany({});
  await prisma.loan.deleteMany({});
  await prisma.movementItemUnit.deleteMany({});
  await prisma.movementItem.deleteMany({});
  await prisma.movement.deleteMany({});
  await prisma.materialOutput.deleteMany({});
  await prisma.deviceUnit.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.deviceType.deleteMany({});
  // Expediente de personal: cuelga de `users`, hay que vaciarlo antes.
  await prisma.disciplinaryReport.deleteMany({});
  await prisma.employeeDocument.deleteMany({});
  await prisma.employeeDiscount.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.subarea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.legacySequence.deleteMany({});

  // ---------------------------------------------------------------------------
  // Tablas sin cambios de modelo (respaldo real de Puerto Nuevo).
  // ---------------------------------------------------------------------------
  const departments = loadFixture("departments");
  await prisma.department.createMany({ data: departments });

  const subareas = loadFixture("subareas");
  await prisma.subarea.createMany({ data: subareas });

  const users = loadFixture("users");
  await prisma.user.createMany({ data: users });

  const notifications = loadFixture("notifications");
  await prisma.notification.createMany({ data: notifications });

  const categoryIdByName = new Map(
    (await prisma.ticketCategory.findMany({ select: { id: true, name: true } })).map(
      (c) => [c.name, c.id] as const
    )
  );
  const tickets = loadFixture<any>("tickets").map(({ category, ...ticket }) => ({
    ...ticket,
    categoryId: category
      ? categoryIdByName.get(CATEGORY_ENUM_TO_NAME[category]) ?? null
      : null,
  }));
  await prisma.ticket.createMany({ data: tickets });

  const ticketAssignments = loadFixture("ticket_assignments");
  await prisma.ticketAssignment.createMany({ data: ticketAssignments });

  const ticketAssignmentComments = loadFixture("ticket_assignment_comments");
  await prisma.ticketAssignmentComment.createMany({ data: ticketAssignmentComments });

  const ticketAttachments = loadFixture("ticket_attachments");
  await prisma.ticketAttachment.createMany({ data: ticketAttachments });

  const ticketComments = loadFixture("ticket_comments");
  await prisma.ticketComment.createMany({ data: ticketComments });

  const ticketHistory = loadFixture("ticket_history");
  await prisma.ticketHistory.createMany({ data: ticketHistory });

  const [legacySequence] = loadFixture<any>("legacy_sequences");
  if (legacySequence) {
    await prisma.legacySequence.upsert({
      where: { id: legacySequence.id },
      update: legacySequence,
      create: legacySequence,
    });
  }

  // ---------------------------------------------------------------------------
  // Inventario (respaldo real, ya convertido al modelo nuevo por
  // `prisma/legacy/extract.ts`). El orden respeta las llaves foráneas.
  // ---------------------------------------------------------------------------
  const deviceTypes = loadFixture("device_types");
  await prisma.deviceType.createMany({ data: deviceTypes });

  const devices = loadFixture("devices");
  await prisma.device.createMany({ data: devices });

  const units = loadFixture("device_units");
  await prisma.deviceUnit.createMany({ data: units });

  const movements = loadFixture("movements");
  await prisma.movement.createMany({ data: movements });

  const movementItems = loadFixture("movement_items");
  await prisma.movementItem.createMany({ data: movementItems });

  await prisma.movementItemUnit.createMany({
    data: loadFixture("movement_item_units"),
  });

  const loans = loadFixture("loans");
  await prisma.loan.createMany({ data: loans });

  await prisma.loanItem.createMany({ data: loadFixture("loan_items") });
  await prisma.loanItemUnit.createMany({
    data: loadFixture("loan_item_units"),
  });

  const materialOutputs = loadFixture("material_outputs");
  if (materialOutputs.length > 0) {
    await prisma.materialOutput.createMany({ data: materialOutputs });
  }

  const auditLogs = loadFixture("audit_logs");
  await prisma.auditLog.createMany({ data: auditLogs });

  console.log("Seed completo (respaldo real de Puerto Nuevo):");
  console.log(`  ${departments.length} departamentos, ${subareas.length} subáreas`);
  console.log(`  ${users.length} usuarios`);
  console.log(`  ${deviceTypes.length} tipos de dispositivo`);
  console.log(`  ${devices.length} dispositivos con ${units.length} unidades físicas`);
  console.log(`  ${movements.length} movimientos, ${loans.length} cartas responsivas vigentes`);
  console.log(`  ${tickets.length} tickets, ${auditLogs.length} registros de auditoría`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });