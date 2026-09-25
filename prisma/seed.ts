import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { sembrarMatrizPorDefecto } from "../src/core/permisos/matriz";
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

const GENEROS = ["Masculino", "Femenino", "Otro", "Prefiere no decir"];

const TIPOS_SANGRE = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

// Categorías de ticket (antes enum TicketCategory). El nombre coincide con el
// que inserta la migración `ticket_category_catalog`.
const TICKET_CATEGORIAS = ["Mantenimiento", "Equipo", "Sistema", "Otro"];

// Mapea el valor del enum viejo (en los fixtures) al nombre del catálogo.
const CATEGORY_ENUM_TO_NOMBRE: Record<string, string> = {
  MANTENIMIENTO: "Mantenimiento",
  EQUIPO: "Equipo",
  SISTEMA: "Sistema",
  OTRO: "Otro",
};

const TIPOS_DOCUMENTO = [
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
  for (const nombre of GENEROS) {
    await prisma.genero.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  for (const nombre of TIPOS_SANGRE) {
    await prisma.tipoSangre.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  for (const [orden, nombre] of TIPOS_DOCUMENTO.entries()) {
    await prisma.tipoDocumento.upsert({
      where: { nombre },
      update: { orden },
      create: { nombre, orden },
    });
  }
  for (const nombre of TICKET_CATEGORIAS) {
    await prisma.ticketCategory.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  console.log(
    `Catálogos RH listos: ${GENEROS.length} géneros, ${TIPOS_SANGRE.length} tipos de sangre, ${TIPOS_DOCUMENTO.length} tipos de documento, ${TICKET_CATEGORIAS.length} categorías de ticket`
  );
}

// Horarios de ejemplo (módulo de administración). Se siembran por nombre si no
// existen, para que el módulo de horarios tenga catálogo desde el arranque.
type SeedHorarioDia = {
  diaSemana: number;
  entrada?: string;
  salida?: string;
  entrada2?: string;
  salida2?: string;
  descanso?: boolean;
};

/** Lunes–viernes con la misma jornada; sábado/domingo configurables. */
function week(
  entrada: string,
  salida: string,
  opts: {
    sab?: [string, string];
    dom?: [string, string] | "rest";
    partido?: [string, string];
  } = {}
): SeedHorarioDia[] {
  const out: SeedHorarioDia[] = [];
  for (let d = 1; d <= 5; d++) {
    out.push({
      diaSemana: d,
      entrada,
      salida,
      entrada2: opts.partido?.[0],
      salida2: opts.partido?.[1],
    });
  }
  out.push({
    diaSemana: 6,
    entrada: opts.sab?.[0] ?? entrada,
    salida: opts.sab?.[1] ?? salida,
    entrada2: opts.partido?.[0],
    salida2: opts.partido?.[1],
  });
  const dom = opts.dom ?? "rest";
  if (dom === "rest") out.push({ diaSemana: 7, descanso: true });
  else out.push({ diaSemana: 7, entrada: dom[0], salida: dom[1] });
  return out;
}

const SEED_HORARIOS: Array<{
  nombre: string;
  comidaMin?: number;
  cruzaMedianoche?: boolean;
  dias: SeedHorarioDia[];
}> = [
  { nombre: "Matutino", comidaMin: 30, dias: week("08:00", "16:00", { sab: ["08:00", "14:00"] }) },
  { nombre: "Vespertino", comidaMin: 30, cruzaMedianoche: true, dias: week("16:00", "00:00", { sab: ["14:00", "22:00"] }) },
  { nombre: "Nocturno", comidaMin: 30, cruzaMedianoche: true, dias: week("22:00", "06:00") },
  { nombre: "Desayunos", comidaMin: 30, dias: week("06:00", "14:00") },
  { nombre: "Restaurante (mixto)", comidaMin: 30, dias: week("12:00", "20:00", { dom: ["12:00", "18:00"] }) },
  { nombre: "Camaristas (turno partido)", comidaMin: 0, dias: week("08:00", "13:00", { partido: ["16:00", "20:00"] }) },
  { nombre: "Centro de consumo (partido)", comidaMin: 0, dias: week("10:00", "14:00", { partido: ["17:00", "21:00"] }) },
  { nombre: "Administrativo", comidaMin: 60, dias: week("09:00", "18:00") },
  {
    nombre: "Guardia (12 h)",
    comidaMin: 0,
    cruzaMedianoche: true,
    dias: [1, 2, 3, 4, 5, 6, 7].map((diaSemana) => ({ diaSemana, entrada: "19:00", salida: "07:00" })),
  },
  { nombre: "Medio turno (S)", comidaMin: 0, dias: week("08:00", "12:00") },
];

async function seedHorarios() {
  let created = 0;
  for (const h of SEED_HORARIOS) {
    const exists = await prisma.horario.findUnique({ where: { nombre: h.nombre } });
    if (exists) continue;
    await prisma.horario.create({
      data: {
        nombre: h.nombre,
        toleranciaEntradaMin: 10,
        toleranciaSalidaMin: 10,
        comidaMin: h.comidaMin ?? 0,
        cruzaMedianoche: h.cruzaMedianoche ?? false,
        dias: {
          create: h.dias.map((d) => ({
            diaSemana: d.diaSemana,
            descanso: d.descanso ?? false,
            entrada: d.descanso ? null : d.entrada ?? null,
            salida: d.descanso ? null : d.salida ?? null,
            entrada2: d.descanso ? null : d.entrada2 ?? null,
            salida2: d.descanso ? null : d.salida2 ?? null,
          })),
        },
      },
    });
    created += 1;
  }
  console.log(`Horarios listos: ${created} nuevos (${SEED_HORARIOS.length} en el catálogo)`);
}

async function main() {
  await seedHrCatalogs();
  await seedHorarios();

  // Matriz rol → permiso → alcance: insert-missing desde los defaults del
  // código, para que corra también en bases ya sembradas (no pisa ediciones).
  const permisosCreados = await sembrarMatrizPorDefecto(prisma);
  console.log(`Matriz de permisos lista: ${permisosCreados} filas nuevas`);

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    // `20260917195258_inventario_model` borra el inventario del modelo viejo.
    // Si quedan usuarios pero ni un tipo de dispositivo, es que esa migración
    // ya corrió y el respaldo nunca se cargó: la base quedó a medias. Se corta
    // aquí en vez de arrancar sirviendo un inventario vacío.
    const tipos = await prisma.tipoDispositivo.count();
    if (tipos === 0) {
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
  await prisma.devolucionDetalleUnidad.deleteMany({});
  await prisma.devolucionDetalle.deleteMany({});
  await prisma.devolucion.deleteMany({});
  await prisma.prestamoDetalleUnidad.deleteMany({});
  await prisma.prestamoDetalle.deleteMany({});
  await prisma.prestamo.deleteMany({});
  await prisma.movimientoDetalleUnidad.deleteMany({});
  await prisma.movimientoDetalle.deleteMany({});
  await prisma.movimiento.deleteMany({});
  await prisma.materialOutput.deleteMany({});
  await prisma.unidadFisica.deleteMany({});
  await prisma.dispositivo.deleteMany({});
  await prisma.tipoDispositivo.deleteMany({});
  // Expediente de personal: cuelga de `users`, hay que vaciarlo antes.
  await prisma.cartaAdministrativa.deleteMany({});
  await prisma.employeeDocument.deleteMany({});
  await prisma.employeeDiscount.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.subarea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.consecutivo.deleteMany({});

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

  const categoryIdByNombre = new Map(
    (await prisma.ticketCategory.findMany({ select: { id: true, nombre: true } })).map(
      (c) => [c.nombre, c.id] as const
    )
  );
  const tickets = loadFixture<any>("tickets").map(({ category, ...ticket }) => ({
    ...ticket,
    categoryId: category
      ? categoryIdByNombre.get(CATEGORY_ENUM_TO_NOMBRE[category]) ?? null
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

  const [consecutivo] = loadFixture<any>("consecutivos");
  if (consecutivo) {
    await prisma.consecutivo.upsert({
      where: { id: consecutivo.id },
      update: consecutivo,
      create: consecutivo,
    });
  }

  // ---------------------------------------------------------------------------
  // Inventario (respaldo real, ya convertido al modelo nuevo por
  // `prisma/legacy/extract.ts`). El orden respeta las llaves foráneas.
  // ---------------------------------------------------------------------------
  const tiposDispositivo = loadFixture("tipos_dispositivo");
  await prisma.tipoDispositivo.createMany({ data: tiposDispositivo });

  const dispositivos = loadFixture("dispositivos");
  await prisma.dispositivo.createMany({ data: dispositivos });

  const unidades = loadFixture("unidades_fisicas");
  await prisma.unidadFisica.createMany({ data: unidades });

  const movimientos = loadFixture("movimientos");
  await prisma.movimiento.createMany({ data: movimientos });

  const movimientoDetalles = loadFixture("movimiento_detalles");
  await prisma.movimientoDetalle.createMany({ data: movimientoDetalles });

  await prisma.movimientoDetalleUnidad.createMany({
    data: loadFixture("movimiento_detalle_unidades"),
  });

  const prestamos = loadFixture("prestamos");
  await prisma.prestamo.createMany({ data: prestamos });

  await prisma.prestamoDetalle.createMany({ data: loadFixture("prestamo_detalles") });
  await prisma.prestamoDetalleUnidad.createMany({
    data: loadFixture("prestamo_detalle_unidades"),
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
  console.log(`  ${tiposDispositivo.length} tipos de dispositivo`);
  console.log(`  ${dispositivos.length} dispositivos con ${unidades.length} unidades físicas`);
  console.log(`  ${movimientos.length} movimientos, ${prestamos.length} cartas responsivas vigentes`);
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