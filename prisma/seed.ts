import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, "seed-data");

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
  console.log(
    `Catálogos RH listos: ${GENEROS.length} géneros, ${TIPOS_SANGRE.length} tipos de sangre, ${TIPOS_DOCUMENTO.length} tipos de documento`
  );
}

async function main() {
  await seedHrCatalogs();

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
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
  await prisma.movimientoDetalle.deleteMany({});
  await prisma.movimiento.deleteMany({});
  await prisma.materialOutput.deleteMany({});
  await prisma.unidadFisica.deleteMany({});
  await prisma.dispositivo.deleteMany({});
  await prisma.tipoDispositivo.deleteMany({});
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

  const tickets = loadFixture("tickets");
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
  // Inventario (nuevo modelo) — datos demo coherentes.
  // ---------------------------------------------------------------------------
  const primerEmpleado = await prisma.user.findFirst({
    where: { role: { not: "ADMIN" } },
    orderBy: { username: "asc" },
  });
  const autor = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  const creadorId = autor?.id ?? primerEmpleado?.id;
  if (!creadorId) throw new Error("No hay usuarios para sembrar inventario");

  // Tipos
  const tipos: {
    name: string;
    code: string;
    folioPrefix: string;
    useSerie?: boolean;
    useMac?: boolean;
    useIp?: boolean;
    useEquipo?: boolean;
  }[] = [
    { name: "Tablet", code: "TABLET", folioPrefix: "TAB", useSerie: true, useMac: true, useIp: true, useEquipo: true },
    { name: "Teléfono", code: "TELEFONO", folioPrefix: "TEL", useSerie: true, useMac: true, useEquipo: true },
    { name: "Laptop", code: "LAPTOP", folioPrefix: "LAP", useSerie: true, useMac: true, useIp: true, useEquipo: true },
    { name: "Monitor", code: "MONITOR", folioPrefix: "MON", useSerie: true, useMac: true },
    { name: "Mouse", code: "MOUSE", folioPrefix: "MOU", useSerie: true },
    { name: "Teclado", code: "TECLADO", folioPrefix: "TEC", useSerie: true },
  ];
  const tipoMap: Record<string, string> = {};
  for (const t of tipos) {
    const tipo = await prisma.tipoDispositivo.create({ data: t });
    tipoMap[t.name] = tipo.id;
  }

  // Dispositivos + unidades físicas + entrada inicial
  const modelos: {
    tipo: string;
    nombre: string;
    marca: string;
    modelo: string;
    cantidad: number;
  }[] = [
    { tipo: "Tablet", nombre: "Samsung A9", marca: "Samsung", modelo: "A9", cantidad: 15 },
    { tipo: "Tablet", nombre: "iPad Pro", marca: "Apple", modelo: "iPad Pro 11", cantidad: 50 },
    { tipo: "Laptop", nombre: "HP ProBook 450", marca: "HP", modelo: "ProBook 450 G8", cantidad: 20 },
    { tipo: "Monitor", nombre: "LG 24MK600", marca: "LG", modelo: "24MK600", cantidad: 10 },
    { tipo: "Mouse", nombre: "Logitech M90", marca: "Logitech", modelo: "M90", cantidad: 30 },
    { tipo: "Teclado", nombre: "Logitech K120", marca: "Logitech", modelo: "K120", cantidad: 30 },
  ];

  for (const m of modelos) {
    const tipo = await prisma.tipoDispositivo.findUnique({
      where: { id: tipoMap[m.tipo] },
    });
    if (!tipo) continue;
    const disp = await prisma.dispositivo.create({
      data: {
        tipoId: tipo.id,
        nombre: m.nombre,
        marca: m.marca,
        modelo: m.modelo,
        descripcion: `${m.marca} ${m.modelo}`,
      },
    });

    // Unidades físicas con activo fijo generado internamente (único por tipo).
    let contador = tipo.contador;
    const unidades = [];
    for (let i = 1; i <= m.cantidad; i++) {
      contador += 1;
      const activoFijo = `${tipo.folioPrefix}-${String(contador).padStart(4, "0")}`;
      unidades.push(
        prisma.unidadFisica.create({
          data: {
            dispositivoId: disp.id,
            activoFijo,
            estado: "DISPONIBLE",
          },
        })
      );
    }
    await Promise.all(unidades);
    await prisma.tipoDispositivo.update({
      where: { id: tipo.id },
      data: { contador },
    });

    // Movimiento ENTRADA (inicial).
    await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA",
        usuarioId: creadorId,
        motivo: "Alta inicial",
        detalles: {
          create: [{ dispositivoId: disp.id, cantidad: m.cantidad }],
        },
      },
    });
  }

  // Préstamo demo: Samsung A9 × 2 al primer empleado.
  const samsung = await prisma.dispositivo.findFirst({
    where: { nombre: "Samsung A9" },
  });
  if (samsung && primerEmpleado) {
    const unidades = await prisma.unidadFisica.findMany({
      where: { dispositivoId: samsung.id, estado: "DISPONIBLE" },
      orderBy: { activoFijo: "asc" },
      take: 2,
    });

    const prestamo = await prisma.prestamo.create({
      data: {
        responsableId: primerEmpleado.id,
        consecutivo: "CARTA-0001",
        observaciones: "Préstamo demo",
      },
    });

    const detalle = await prisma.prestamoDetalle.create({
      data: {
        prestamoId: prestamo.id,
        dispositivoId: samsung.id,
        cantidad: unidades.length,
      },
    });

    for (const u of unidades) {
      await prisma.prestamoDetalleUnidad.create({
        data: {
          prestamoDetalleId: detalle.id,
          unidadFisicaId: u.id,
        },
      });
      await prisma.unidadFisica.update({
        where: { id: u.id },
        data: { estado: "PRESTADO" },
      });
    }

    const movimientoPrestamo = await prisma.movimiento.create({
      data: {
        tipo: "PRESTAMO",
        usuarioId: creadorId,
        responsableId: primerEmpleado.id,
        motivo: "Préstamo demo",
        detalles: {
          create: [{ dispositivoId: samsung.id, cantidad: unidades.length }],
        },
      },
    });
    await prisma.prestamo.update({
      where: { id: prestamo.id },
      data: { movimientoId: movimientoPrestamo.id },
    });

    // Devolución parcial demo: 1 unidad regresa (Bueno).
    if (unidades[0]) {
      const movimientoDevolucion = await prisma.movimiento.create({
        data: {
          tipo: "DEVOLUCION",
          usuarioId: creadorId,
          responsableId: primerEmpleado.id,
          motivo: "Devolución parcial demo",
          detalles: {
            create: [
              {
                dispositivoId: samsung.id,
                cantidad: 1,
                condicion: "BUENO",
              },
            ],
          },
        },
      });

      const devolucion = await prisma.devolucion.create({
        data: {
          prestamoId: prestamo.id,
          movimientoId: movimientoDevolucion.id,
          responsableId: primerEmpleado.id,
          consecutivo: "DEV-0001",
          observaciones: "Devolución parcial demo",
        },
      });

      await prisma.devolucionDetalle.create({
        data: {
          devolucionId: devolucion.id,
          prestamoDetalleId: detalle.id,
          dispositivoId: samsung.id,
          cantidad: 1,
          condicion: "BUENO",
          unidades: {
            create: [{ unidadFisicaId: unidades[0].id }],
          },
        },
      });

      await prisma.unidadFisica.update({
        where: { id: unidades[0].id },
        data: { estado: "DISPONIBLE" },
      });
      await prisma.prestamoDetalle.update({
        where: { id: detalle.id },
        data: { devuelto: 1 },
      });
      await prisma.prestamo.update({
        where: { id: prestamo.id },
        data: { status: "PARCIAL" },
      });
    }
  }

  console.log("Seed completo (modelo de inventario nuevo):");
  console.log(`  ${departments.length} departamentos, ${subareas.length} subáreas`);
  console.log(`  ${users.length} usuarios`);
  console.log(`  ${tipos.length} tipos de dispositivo`);
  console.log(`  ${modelos.length} dispositivos (modelo) con unidades físicas`);
  console.log(`  préstamo + devolución parcial demo (Samsung A9)`);
  console.log(`  ${tickets.length} tickets`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });