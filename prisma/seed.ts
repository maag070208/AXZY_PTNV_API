import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Semilla = respaldo real de Puerto Nuevo (backup_cartas_20260917_102024),
// exportado a JSON por tabla en ./seed-data. Reemplaza los datos ficticios que
// este script generaba antes: al arrancar en limpio (o con FORCE_RESET=1), la
// app queda poblada con el inventario/cartas/tickets reales del respaldo.
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, "seed-data");

// Los timestamps del dump vienen como "YYYY-MM-DD HH:MM:SS(.ms)" (columnas
// `timestamp without time zone`, en hora UTC porque así los escribe Prisma).
// Se reviven a Date interpretándolos como UTC.
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

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    console.log(`Seed omitido: la BD ya tiene ${existingUsers} usuarios.`);
    console.log(`  Para forzar el reset: FORCE_RESET=1 npx prisma db seed`);
    return;
  }

  // -------------------------------------------------------------------------
  // Reset de datos (hijos antes que padres, respeta FKs).
  // -------------------------------------------------------------------------
  await prisma.auditLog.deleteMany({});
  await prisma.ticketAttachment.deleteMany({});
  await prisma.ticketAssignmentComment.deleteMany({});
  await prisma.ticketAssignment.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.materialOutput.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.cartaItem.deleteMany({});
  await prisma.cartaResponsiva.deleteMany({});
  await prisma.deviceHistory.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.subarea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.deviceType.deleteMany({});
  await prisma.consecutivo.deleteMany({});

  // -------------------------------------------------------------------------
  // Carga en orden de dependencia FK.
  // -------------------------------------------------------------------------
  const departments = loadFixture("departments");
  await prisma.department.createMany({ data: departments });

  const subareas = loadFixture("subareas");
  await prisma.subarea.createMany({ data: subareas });

  const deviceTypes = loadFixture("device_types");
  await prisma.deviceType.createMany({ data: deviceTypes });

  const users = loadFixture("users");
  await prisma.user.createMany({ data: users });

  const devices = loadFixture("devices");
  await prisma.device.createMany({ data: devices });

  const deviceHistory = loadFixture("device_history");
  await prisma.deviceHistory.createMany({ data: deviceHistory });

  const cartas = loadFixture("cartas_responsivas");
  await prisma.cartaResponsiva.createMany({ data: cartas });

  const cartaItems = loadFixture("carta_items");
  await prisma.cartaItem.createMany({ data: cartaItems });

  // inventoryMovement.prestamoId es una auto-referencia (la devolución apunta
  // al préstamo); se inserta primero sin ese campo y se enlaza en un segundo
  // paso, ya que todos los ids existen.
  const movimientos = loadFixture<any>("inventory_movements");
  await prisma.inventoryMovement.createMany({
    data: movimientos.map(({ prestamoId, ...rest }) => rest),
  });
  for (const m of movimientos) {
    if (m.prestamoId) {
      await prisma.inventoryMovement.update({
        where: { id: m.id },
        data: { prestamoId: m.prestamoId },
      });
    }
  }

  const materialOutputs = loadFixture("material_outputs");
  await prisma.materialOutput.createMany({ data: materialOutputs });

  const [consecutivo] = loadFixture<any>("consecutivos");
  if (consecutivo) {
    await prisma.consecutivo.upsert({
      where: { id: consecutivo.id },
      update: consecutivo,
      create: consecutivo,
    });
  }

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

  const auditLogs = loadFixture("audit_logs");
  await prisma.auditLog.createMany({ data: auditLogs });

  console.log("Seed completo (respaldo real de Puerto Nuevo):");
  console.log(`  ${departments.length} departamentos, ${subareas.length} subáreas`);
  console.log(`  ${deviceTypes.length} tipos de dispositivo, ${devices.length} dispositivos`);
  console.log(`  ${users.length} usuarios`);
  console.log(`  ${cartas.length} cartas responsivas, ${cartaItems.length} items`);
  console.log(`  ${movimientos.length} movimientos de inventario, ${materialOutputs.length} salidas de material`);
  console.log(`  ${tickets.length} tickets`);
  console.log("");
  console.log("  Las contraseñas son las hasheadas reales del respaldo (no se regeneraron).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
