import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMPRESA_DEFAULT = "Puerto Nuevo Hotel y Villas";
const CONSECUTIVO_PREFIJO = "F-MMTO-";

// ---------------------------------------------------------------------------
// Departamentos reales de Puerto Nuevo (sin subareas inventadas).
// ---------------------------------------------------------------------------
const DEPARTAMENTOS: string[] = [
  "RECEPCION",
  "RESERVACIONES",
  "EVENTOS Y BODAS",
  "ADMINISTRACION",
  "ALMACEN",
  "SPA",
  "AMA DE LLAVES",
  "MOZOS",
  "JARDINEROS",
  "MANTENIMIENTO",
  "ALIMENTOS Y BEBIDAS",
  "SISTEMAS",
  "SEGURIDAD",
  "CABALLERIZAS",
];

// ---------------------------------------------------------------------------
// Tipos de dispositivo (catálogo estructural, no depende de empleados).
// ---------------------------------------------------------------------------
const DEVICE_TYPES = [
  { code: "LAPTOP", prefix: "LPT", name: "Laptop" },
  { code: "PC", prefix: "PCE", name: "PC de escritorio" },
  { code: "TABLET", prefix: "TBE", name: "Tablet" },
  { code: "IMPRESORA", prefix: "PRN", name: "Impresora" },
  { code: "TELEFONO", prefix: "TEL", name: "Teléfono" },
];

// ---------------------------------------------------------------------------
// Ubicaciones base.
// ---------------------------------------------------------------------------
const LOCATIONS = [
  { lugar: "BODEGA", subLugar: null, numero: null, descripcion: "Bodega principal de equipos" },
  { lugar: "OFICINA", subLugar: "SISTEMAS", numero: null, descripcion: "Oficina del departamento de sistemas" },
  { lugar: "OFICINA", subLugar: "ADMINISTRACION", numero: null, descripcion: "Oficinas administrativas" },
  { lugar: "RECEPCION", subLugar: null, numero: null, descripcion: "Área de recepción principal" },
];

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    console.log(`Seed omitido: la BD ya tiene ${existingUsers} usuarios.`);
    console.log(`  Para forzar el reset: FORCE_RESET=1 npx prisma db seed`);
    return;
  }

  // -------------------------------------------------------------------------
  // Reset de datos (orden respeta FKs).
  // -------------------------------------------------------------------------
  await prisma.auditLog.deleteMany({});
  await prisma.materialOutput.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.cartaItem.deleteMany({});
  await prisma.cartaResponsiva.deleteMany({});
  await prisma.deviceHistory.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.subarea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.deviceType.deleteMany({});
  await prisma.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: 0, prefijo: CONSECUTIVO_PREFIJO },
    create: { id: "singleton", prefijo: CONSECUTIVO_PREFIJO, contador: 0 },
  });

  // -------------------------------------------------------------------------
  // Ubicaciones
  // -------------------------------------------------------------------------
  for (const loc of LOCATIONS) {
    await prisma.location.create({ data: loc });
  }

  // -------------------------------------------------------------------------
  // Departamentos reales
  // -------------------------------------------------------------------------
  const deptByName: Record<string, { id: string }> = {};
  for (const name of DEPARTAMENTOS) {
    deptByName[name] = await prisma.department.create({ data: { name, active: true } });
  }

  // -------------------------------------------------------------------------
  // Tipos de dispositivo
  // -------------------------------------------------------------------------
  for (const t of DEVICE_TYPES) {
    await prisma.deviceType.create({
      data: { code: t.code, prefix: t.prefix, name: t.name, contador: 0, cartaContador: 0, active: true },
    });
  }

  // -------------------------------------------------------------------------
  // Usuarios: solo admin y aamaro.
  // -------------------------------------------------------------------------
  const adminPwd = process.env.INITIAL_ADMIN_PASSWORD ?? "admin123";
  await prisma.user.create({
    data: {
      username: "admin",
      name: "Administrador",
      role: "ADMIN",
      active: true,
      puesto: "Director TI",
      numeroEmpleado: "EMP-001",
      empresa: EMPRESA_DEFAULT,
      departmentId: deptByName["SISTEMAS"].id,
      password: await bcrypt.hash(adminPwd, 10),
    },
  });

  const aamaroPwd = process.env.INITIAL_AAMARO_PASSWORD ?? "aamaro123";
  await prisma.user.create({
    data: {
      username: "aamaro",
      name: "Amaro",
      role: "ADMIN",
      active: true,
      puesto: "Sistemas",
      numeroEmpleado: "EMP-002",
      empresa: EMPRESA_DEFAULT,
      departmentId: deptByName["SISTEMAS"].id,
      password: await bcrypt.hash(aamaroPwd, 10),
    },
  });

  console.log("Seed completo:");
  console.log(`  ${LOCATIONS.length} ubicaciones`);
  console.log(`  ${DEPARTAMENTOS.length} departamentos reales (sin subareas)`);
  console.log(`  ${DEVICE_TYPES.length} tipos de dispositivo`);
  console.log(`  2 usuarios: admin y aamaro`);
  console.log("");
  console.log(`  Login admin:  admin  / ${adminPwd}`);
  console.log(`  Login aamaro: aamaro / ${aamaroPwd}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
