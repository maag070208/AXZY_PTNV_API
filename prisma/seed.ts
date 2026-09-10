import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { defaultDeviceFieldConfig } from "../src/modules/device-types/device-type.fields";

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
  // Catch-all para todo lo que no lleva numero de serie propio (teclados,
  // mouse, mousepads, monitores, SSDs, memorias USB, etc.): se da de alta
  // como Dispositivo igual que cualquier otro, para que pueda tener su
  // propia carta responsiva individual con folio de activo autogenerado.
  { code: "GENERICO", prefix: "GEN", name: "Genérico" },
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

// ---------------------------------------------------------------------------
// A partir de aquí: datos de EJEMPLO (ficticios), solo para poder probar el
// flujo completo (empleados, dispositivos, inventario y tickets) sin tener
// que capturar todo a mano. A diferencia de lo de arriba (que sí es
// información real de Puerto Nuevo), esto se puede editar o borrar libremente.
// ---------------------------------------------------------------------------
const EMPLEADOS_EJEMPLO = [
  { username: "cmendoza", name: "Carlos Mendoza", puesto: "Recepcionista", numeroEmpleado: "EMP-003", departamento: "RECEPCION" },
  { username: "ltorres", name: "Laura Torres", puesto: "Supervisora de Ama de Llaves", numeroEmpleado: "EMP-004", departamento: "AMA DE LLAVES" },
  { username: "jramirez", name: "Jorge Ramírez", puesto: "Técnico de Mantenimiento", numeroEmpleado: "EMP-005", departamento: "MANTENIMIENTO" },
  { username: "sherrera", name: "Sofía Herrera", puesto: "Chef Ejecutivo", numeroEmpleado: "EMP-006", departamento: "ALIMENTOS Y BEBIDAS" },
  { username: "mruiz", name: "Miguel Ángel Ruiz", puesto: "Jefe de Seguridad", numeroEmpleado: "EMP-007", departamento: "SEGURIDAD" },
  { username: "dflores", name: "Daniela Flores", puesto: "Coordinadora de Eventos", numeroEmpleado: "EMP-008", departamento: "EVENTOS Y BODAS" },
];

// Cada renglón es un "lote" de N unidades idénticas (mismo tipo/marca/modelo).
// Las que sí llevan serie (conSerie: true) reciben una serie única
// autogenerada por unidad; las que no (Genérico) se quedan sin serie, tal
// como se cargarían por el asistente de Excel.
const DEVICES_EJEMPLO: Array<{
  typeCode: string;
  marca: string;
  modelo: string;
  descripcion: string;
  cantidad: number;
  conSerie: boolean;
  lugar: string;
  subLugar: string | null;
}> = [
  { typeCode: "LAPTOP", marca: "Dell", modelo: "Latitude 5420", descripcion: "Laptop administrativa", cantidad: 3, conSerie: true, lugar: "OFICINA", subLugar: "SISTEMAS" },
  { typeCode: "LAPTOP", marca: "HP", modelo: "EliteBook 840", descripcion: "Laptop administrativa", cantidad: 2, conSerie: true, lugar: "BODEGA", subLugar: null },
  { typeCode: "PC", marca: "Dell", modelo: "OptiPlex 7010", descripcion: "PC de escritorio", cantidad: 5, conSerie: true, lugar: "OFICINA", subLugar: "ADMINISTRACION" },
  { typeCode: "PC", marca: "HP", modelo: "ProDesk 400", descripcion: "PC de escritorio", cantidad: 3, conSerie: true, lugar: "BODEGA", subLugar: null },
  { typeCode: "TABLET", marca: "Apple", modelo: "iPad 9na gen", descripcion: "Tablet para checklists", cantidad: 12, conSerie: true, lugar: "BODEGA", subLugar: null },
  { typeCode: "TABLET", marca: "Samsung", modelo: "Galaxy Tab A8", descripcion: "Tablet para checklists", cantidad: 8, conSerie: true, lugar: "RECEPCION", subLugar: null },
  { typeCode: "IMPRESORA", marca: "HP", modelo: "LaserJet Pro M404", descripcion: "Impresora láser", cantidad: 4, conSerie: true, lugar: "RECEPCION", subLugar: null },
  { typeCode: "IMPRESORA", marca: "Epson", modelo: "EcoTank L3250", descripcion: "Impresora multifuncional", cantidad: 2, conSerie: true, lugar: "BODEGA", subLugar: null },
  { typeCode: "TELEFONO", marca: "Apple", modelo: "iPhone SE", descripcion: "Teléfono corporativo", cantidad: 6, conSerie: true, lugar: "BODEGA", subLugar: null },
  { typeCode: "TELEFONO", marca: "Samsung", modelo: "Galaxy A14", descripcion: "Teléfono corporativo", cantidad: 4, conSerie: true, lugar: "OFICINA", subLugar: "SISTEMAS" },
  { typeCode: "GENERICO", marca: "Logitech", modelo: "K120", descripcion: "Teclado USB", cantidad: 15, conSerie: false, lugar: "BODEGA", subLugar: null },
  { typeCode: "GENERICO", marca: "Logitech", modelo: "M90", descripcion: "Mouse USB", cantidad: 15, conSerie: false, lugar: "BODEGA", subLugar: null },
  { typeCode: "GENERICO", marca: "Genérico", modelo: "Estándar", descripcion: "Mousepad", cantidad: 10, conSerie: false, lugar: "BODEGA", subLugar: null },
  { typeCode: "GENERICO", marca: "Kingston", modelo: "DataTraveler 32GB", descripcion: "Memoria USB", cantidad: 10, conSerie: false, lugar: "BODEGA", subLugar: null },
  { typeCode: "GENERICO", marca: "Genérico", modelo: "1.8m", descripcion: "Cable HDMI", cantidad: 8, conSerie: false, lugar: "BODEGA", subLugar: null },
];

const TICKETS_EJEMPLO: Array<{
  titulo: string;
  descripcion: string;
  category: "MANTENIMIENTO" | "EQUIPO" | "SISTEMA" | "OTRO";
  priority: "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
  status: "ABIERTO" | "EN_SEGUIMIENTO" | "CERRADO";
  departamento: string;
  creadoPor: string;
  asignadoA: string | null;
}> = [
  {
    titulo: "Aire acondicionado no enfría en habitación 204",
    descripcion: "El huésped reporta que el aire acondicionado enciende pero no enfría la habitación.",
    category: "MANTENIMIENTO", priority: "ALTA", status: "ABIERTO",
    departamento: "MANTENIMIENTO", creadoPor: "jramirez", asignadoA: null,
  },
  {
    titulo: "Laptop de recepción no enciende",
    descripcion: "La laptop de la recepción principal no prende, posible falla de fuente de poder.",
    category: "EQUIPO", priority: "URGENTE", status: "EN_SEGUIMIENTO",
    departamento: "SISTEMAS", creadoPor: "cmendoza", asignadoA: "aamaro",
  },
  {
    titulo: "Solicito acceso a sistema de reservaciones",
    descripcion: "Necesito que me den de alta un usuario en el sistema de reservaciones para consultar disponibilidad.",
    category: "SISTEMA", priority: "MEDIA", status: "ABIERTO",
    departamento: "SISTEMAS", creadoPor: "sherrera", asignadoA: "admin",
  },
  {
    titulo: "Impresora de recepción sin tóner",
    descripcion: "La impresora de recepción marca nivel bajo de tóner, se necesita reemplazo.",
    category: "EQUIPO", priority: "BAJA", status: "CERRADO",
    departamento: "RECEPCION", creadoPor: "cmendoza", asignadoA: "aamaro",
  },
  {
    titulo: "Fuga de agua en cocina principal",
    descripcion: "Se detectó una fuga de agua debajo del fregadero de la cocina principal.",
    category: "MANTENIMIENTO", priority: "URGENTE", status: "EN_SEGUIMIENTO",
    departamento: "MANTENIMIENTO", creadoPor: "sherrera", asignadoA: null,
  },
  {
    titulo: "Cámaras de seguridad del lobby sin señal",
    descripcion: "Las cámaras del área del lobby dejaron de transmitir video desde ayer por la noche.",
    category: "EQUIPO", priority: "ALTA", status: "ABIERTO",
    departamento: "SEGURIDAD", creadoPor: "mruiz", asignadoA: "aamaro",
  },
  {
    titulo: "Solicitud de tablet para checklist de eventos",
    descripcion: "Se requiere una tablet asignada al equipo de eventos para llevar el checklist digital de montajes.",
    category: "EQUIPO", priority: "MEDIA", status: "CERRADO",
    departamento: "EVENTOS Y BODAS", creadoPor: "dflores", asignadoA: "admin",
  },
  {
    titulo: "Sistema de punto de venta se traba constantemente",
    descripcion: "El sistema de punto de venta del restaurante se congela varias veces durante el servicio.",
    category: "SISTEMA", priority: "ALTA", status: "ABIERTO",
    departamento: "ALIMENTOS Y BEBIDAS", creadoPor: "sherrera", asignadoA: null,
  },
];

const STATUS_LABELS: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_SEGUIMIENTO: "En seguimiento",
  CERRADO: "Cerrado",
};

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
  const locationByKey: Record<string, { id: string }> = {};
  for (const loc of LOCATIONS) {
    const created = await prisma.location.create({ data: loc });
    locationByKey[`${loc.lugar}|${loc.subLugar ?? ""}`] = created;
  }

  // -------------------------------------------------------------------------
  // Departamentos reales
  // -------------------------------------------------------------------------
  const deptByName: Record<string, { id: string; name: string }> = {};
  for (const name of DEPARTAMENTOS) {
    deptByName[name] = await prisma.department.create({ data: { name, active: true } });
  }

  // -------------------------------------------------------------------------
  // Tipos de dispositivo
  // -------------------------------------------------------------------------
  const deviceTypeByCode: Record<string, { id: string; prefix: string; contador: number }> = {};
  for (const t of DEVICE_TYPES) {
    deviceTypeByCode[t.code] = await prisma.deviceType.create({
      data: {
        code: t.code,
        prefix: t.prefix,
        name: t.name,
        contador: 0,
        cartaContador: 0,
        active: true,
        fieldConfig: JSON.parse(JSON.stringify(defaultDeviceFieldConfig(t.code))),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Usuarios administradores: admin y aamaro.
  // -------------------------------------------------------------------------
  const adminPwd = process.env.INITIAL_ADMIN_PASSWORD ?? "admin123";
  const adminUser = await prisma.user.create({
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
  const aamaroUser = await prisma.user.create({
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

  const userByUsername: Record<string, { id: string; name: string }> = {
    admin: { id: adminUser.id, name: adminUser.name },
    aamaro: { id: aamaroUser.id, name: aamaroUser.name },
  };

  // -------------------------------------------------------------------------
  // Empleados de ejemplo (ficticios) — para poder probar tickets, asignaciones,
  // etc. sin tener que capturarlos a mano.
  // -------------------------------------------------------------------------
  const empleadoPwd = process.env.INITIAL_EMPLOYEE_PASSWORD ?? "empleado123";
  for (const e of EMPLEADOS_EJEMPLO) {
    const created = await prisma.user.create({
      data: {
        username: e.username,
        name: e.name,
        role: "EMPLEADO",
        active: true,
        puesto: e.puesto,
        numeroEmpleado: e.numeroEmpleado,
        empresa: EMPRESA_DEFAULT,
        departmentId: deptByName[e.departamento].id,
        password: await bcrypt.hash(empleadoPwd, 10),
      },
    });
    userByUsername[e.username] = { id: created.id, name: created.name };
  }

  // -------------------------------------------------------------------------
  // Dispositivos de ejemplo (ficticios). Cada renglón de DEVICES_EJEMPLO se
  // da de alta como un lote de "cantidad" unidades (mismo loteId, como si se
  // hubieran cargado juntas por el asistente de Excel), cada una con su
  // propio folio de activo y su alta en inventario (movimiento ENTRADA).
  // -------------------------------------------------------------------------
  const typeCounters: Record<string, number> = {};
  let totalDevicesCreados = 0;
  for (const spec of DEVICES_EJEMPLO) {
    const type = deviceTypeByCode[spec.typeCode];
    const location = locationByKey[`${spec.lugar}|${spec.subLugar ?? ""}`] ?? null;
    const loteId = spec.cantidad > 1 ? randomUUID() : null;

    for (let i = 0; i < spec.cantidad; i++) {
      const nextCounter = (typeCounters[spec.typeCode] ?? type.contador) + 1;
      typeCounters[spec.typeCode] = nextCounter;
      const controlActivos = `${type.prefix}-${String(nextCounter).padStart(4, "0")}`;
      const numeroSerie = spec.conSerie
        ? `SN-${type.prefix}-${String(nextCounter).padStart(4, "0")}`
        : null;

      const device = await prisma.device.create({
        data: {
          typeId: type.id,
          controlActivos,
          descripcion: spec.descripcion,
          marca: spec.marca,
          modelo: spec.modelo,
          numeroSerie,
          area: "SISTEMAS",
          estado: "DISPONIBLE",
          locationId: location?.id ?? null,
          loteId,
        },
      });
      totalDevicesCreados += 1;

      await prisma.deviceHistory.create({
        data: {
          deviceId: device.id,
          type: "CREATED",
          detail: `${device.marca} ${device.modelo} · ${device.controlActivos}`,
          autorId: adminUser.id,
        },
      });

      if (location) {
        await prisma.inventoryMovement.create({
          data: {
            deviceId: device.id,
            locationId: location.id,
            tipo: "ENTRADA",
            notas: "Alta inicial de inventario (seed)",
            userId: adminUser.id,
          },
        });
      }
    }
  }

  for (const code of Object.keys(typeCounters)) {
    await prisma.deviceType.update({
      where: { id: deviceTypeByCode[code].id },
      data: { contador: typeCounters[code] },
    });
  }

  // -------------------------------------------------------------------------
  // Tickets de ejemplo (ficticios), cubriendo distintas categorías,
  // prioridades, estatus y departamentos.
  // -------------------------------------------------------------------------
  for (const t of TICKETS_EJEMPLO) {
    const creadoPor = userByUsername[t.creadoPor];
    const asignadoA = t.asignadoA ? userByUsername[t.asignadoA] : null;
    const department = deptByName[t.departamento];

    const ticket = await prisma.ticket.create({
      data: {
        titulo: t.titulo,
        descripcion: t.descripcion,
        category: t.category,
        priority: t.priority,
        status: t.status,
        departmentId: department.id,
        creadoPorId: creadoPor.id,
        asignadoAId: asignadoA?.id ?? null,
        ...(t.status === "CERRADO"
          ? { closedAt: new Date(), closedBy: (asignadoA ?? adminUser).id }
          : {}),
      },
    });

    await prisma.ticketHistory.create({
      data: {
        ticketId: ticket.id,
        type: "CREATED",
        detail: `Prioridad ${t.priority} · Categoría ${t.category}`,
        autorId: creadoPor.id,
      },
    });

    await prisma.ticketHistory.create({
      data: {
        ticketId: ticket.id,
        type: "DEPARTMENT",
        detail: `Departamento asignado: ${department.name}`,
        autorId: creadoPor.id,
      },
    });

    if (asignadoA) {
      await prisma.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "ASSIGNED",
          detail: `Responsable asignado: ${asignadoA.name}`,
          autorId: creadoPor.id,
        },
      });
    }

    if (t.status !== "ABIERTO") {
      await prisma.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "STATUS",
          detail: `Estado cambiado a ${STATUS_LABELS[t.status]}`,
          autorId: (asignadoA ?? creadoPor).id,
        },
      });
    }
  }

  console.log("Seed completo:");
  console.log(`  ${LOCATIONS.length} ubicaciones`);
  console.log(`  ${DEPARTAMENTOS.length} departamentos reales (sin subareas)`);
  console.log(`  ${DEVICE_TYPES.length} tipos de dispositivo`);
  console.log(`  2 usuarios admin (admin y aamaro) + ${EMPLEADOS_EJEMPLO.length} empleados de ejemplo`);
  console.log(`  ${totalDevicesCreados} dispositivos de ejemplo (${DEVICES_EJEMPLO.length} lotes), cada uno con su alta en inventario`);
  console.log(`  ${TICKETS_EJEMPLO.length} tickets de ejemplo`);
  console.log("");
  console.log(`  Login admin:    admin    / ${adminPwd}`);
  console.log(`  Login aamaro:   aamaro   / ${aamaroPwd}`);
  console.log(`  Login empleados: <usuario> / ${empleadoPwd}  (ej. cmendoza / ${empleadoPwd})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
