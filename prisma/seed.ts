import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const prefixNum = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, "0")}`;

const deviceControl = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

const at = (base: Date, addDays: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  return d;
};

async function main() {
  // 0) Reset de datos transaccionales (cartas, dispositivos) para reproducir el dataset
  await prisma.cartaResponsiva.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.deviceType.updateMany({ data: { contador: 0 } });
  await prisma.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: 0 },
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });

  // 1) Departamentos + subáreas
  const departments = [
    { name: "A&B", subareas: ["Kiosko", "Mini Market", "Bar", "Restaurant", "Alberca Techada"] },
    { name: "RECURSOS HUMANOS", subareas: [] },
    { name: "CONTABILIDAD", subareas: ["Ingresos", "Egresos"] },
    { name: "ALMACEN", subareas: [] },
    { name: "BODAS", subareas: [] },
    { name: "MARKETIN", subareas: [] },
    { name: "RESERVACIONES", subareas: [] },
    { name: "CALL CENTER", subareas: [] },
    { name: "OPERACIONES", subareas: [] },
    { name: "MANTENIMIENTO", subareas: [] },
  ];

  const deptIds: Record<string, string> = {};
  for (const d of departments) {
    const dep = await prisma.department.upsert({
      where: { name: d.name },
      update: {},
      create: { name: d.name },
    });
    deptIds[d.name] = dep.id;
    for (const s of d.subareas) {
      await prisma.subarea.upsert({
        where: { departmentId_name: { departmentId: dep.id, name: s } },
        update: {},
        create: { departmentId: dep.id, name: s },
      });
    }
  }

  // 2) Tipos de dispositivo
  const deviceTypes = [
    { code: "TABLE", name: "Tablet", prefix: "TBE" },
    { code: "TELEFONO", name: "Teléfono", prefix: "TEL" },
    { code: "IMPRESORA", name: "Impresora", prefix: "PRNT" },
    { code: "LAPTOP", name: "Laptop", prefix: "LPT" },
    { code: "ESCANER", name: "Escáner", prefix: "ESC" },
  ];

  const typeIds: Record<string, string> = {};
  for (const t of deviceTypes) {
    const type = await prisma.deviceType.upsert({
      where: { code: t.code },
      update: { name: t.name, prefix: t.prefix },
      create: { ...t, contador: 0 },
    });
    typeIds[t.code] = type.id;
  }

  // 3) Usuarios — TODOS los roles
  const adminPwd = process.env.INITIAL_ADMIN_PASSWORD ?? "admin123";

  const upsertUser = async (u: {
    username: string;
    name: string;
    role: "ADMIN" | "USER" | "EMPLEADO";
    password: string;
    puesto?: string;
    numeroEmpleado?: string;
    departmentId?: string;
    subareaId?: string;
  }) => {
    const data = {
      username: u.username,
      name: u.name,
      role: u.role,
      active: true,
      puesto: u.puesto,
      numeroEmpleado: u.numeroEmpleado,
      departmentId: u.departmentId,
      subareaId: u.subareaId,
    };
    return prisma.user.upsert({
      where: { username: u.username },
      update: { password: await bcrypt.hash(u.password, 10), ...data },
      create: { ...data, password: await bcrypt.hash(u.password, 10) },
    });
  };

  const admin = await upsertUser({
    username: "admin",
    name: "Administrador",
    role: "ADMIN",
    password: adminPwd,
  });
  const agarcia = await upsertUser({
    username: "agarcia",
    name: "Ana García",
    role: "ADMIN",
    password: "agarcia123",
    puesto: "Gerente General",
    departmentId: deptIds["OPERACIONES"],
  });

  const usuario = await upsertUser({
    username: "usuario",
    name: "Juan Hernández",
    role: "USER",
    password: "user123",
    puesto: "Coordinador de Mantenimiento",
    departmentId: deptIds["MANTENIMIENTO"],
  });
  const cramirez = await upsertUser({
    username: "cramirez",
    name: "Carlos Ramírez",
    role: "USER",
    password: "cramirez123",
    puesto: "Jefe de Operaciones",
    departmentId: deptIds["OPERACIONES"],
  });

  const restaurantSub = await prisma.subarea.findUnique({
    where: { departmentId_name: { departmentId: deptIds["A&B"], name: "Restaurant" } },
  });

  const empleados = [
    { username: "jperez", name: "Juan Pérez", puesto: "Técnico de Mantenimiento", numeroEmpleado: "EMP-001", departmentId: deptIds["MANTENIMIENTO"] },
    { username: "mlopez", name: "María López", puesto: "Jefa de Sistemas", numeroEmpleado: "EMP-002", departmentId: deptIds["RECURSOS HUMANOS"] },
    { username: "rgarcia", name: "Rosa García", puesto: "Coordinadora A&B", numeroEmpleado: "EMP-003", departmentId: deptIds["A&B"], subareaId: restaurantSub?.id },
    { username: "lhernandez", name: "Luis Hernández", puesto: "Almacenista", numeroEmpleado: "EMP-004", departmentId: deptIds["ALMACEN"] },
    { username: "cflores", name: "Carla Flores", puesto: "Recepcionista", numeroEmpleado: "EMP-005", departmentId: deptIds["OPERACIONES"] },
    { username: "ddiaz", name: "Diego Díaz", puesto: "Contador", numeroEmpleado: "EMP-006", departmentId: deptIds["CONTABILIDAD"] },
    { username: "sbaez", name: "Sofía Báez", puesto: "Agente de Reservaciones", numeroEmpleado: "EMP-007", departmentId: deptIds["RESERVACIONES"] },
    { username: "mtorres", name: "Miguel Torres", puesto: "Auxiliar de Compras", numeroEmpleado: "EMP-008", departmentId: deptIds["ALMACEN"] },
  ];

  const empMap: Record<string, any> = {};
  for (const e of empleados) {
    empMap[e.username] = await upsertUser({
      ...e,
      role: "EMPLEADO",
      password: `${e.username}123`,
    });
  }

  // 4) Dispositivos
  const devices: Array<{
    code: string;
    descripcion: string;
    marca: string;
    modelo: string;
    cantidad?: number;
    numeroSerie?: string;
    nombreEquipo?: string;
    estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
  }> = [
    { code: "TABLE", descripcion: "Tablet Samsung Galaxy Tab A7", marca: "Samsung", modelo: "SM-T500", cantidad: 1, numeroSerie: "SN-TBE-0001", nombreEquipo: "Tablet Recepción" },
    { code: "TABLE", descripcion: "Tablet Lenovo Tab M10", marca: "Lenovo", modelo: "TB-X605", cantidad: 1, numeroSerie: "SN-TBE-0002", nombreEquipo: "Tablet Restaurant" },
    { code: "TABLE", descripcion: "Tablet Huawei MatePad", marca: "Huawei", modelo: "BAH3-W09", cantidad: 1, numeroSerie: "SN-TBE-0003", nombreEquipo: "Tablet Kiosko", estado: "DISPONIBLE" },
    { code: "TELEFONO", descripcion: "Teléfono Claro H816G", marca: "Claro", modelo: "H816G", cantidad: 1, numeroSerie: "SN-TEL-0001", nombreEquipo: "Teléfono Operaciones" },
    { code: "TELEFONO", descripcion: "Teléfono AT&T Cingular Flex", marca: "AT&T", modelo: "Flex", cantidad: 1, numeroSerie: "SN-TEL-0002", nombreEquipo: "Teléfono Call Center", estado: "BAJA" },
    { code: "IMPRESORA", descripcion: "Impresora Epson L3250", marca: "Epson", modelo: "L3250", cantidad: 1, numeroSerie: "SN-PRNT-0001", nombreEquipo: "Impresora Almacén" },
    { code: "IMPRESORA", descripcion: "Impresora HP LaserJet M404", marca: "HP", modelo: "M404dn", cantidad: 1, numeroSerie: "SN-PRNT-0002", nombreEquipo: "Impresora Contabilidad" },
    { code: "IMPRESORA", descripcion: "Impresora Brother HL-1210", marca: "Brother", modelo: "HL-1210W", cantidad: 1, numeroSerie: "SN-PRNT-0003", nombreEquipo: "Impresora RRHH", estado: "DISPONIBLE" },
    { code: "LAPTOP", descripcion: "Laptop HP ProBook 450 G8", marca: "HP", modelo: "450 G8", cantidad: 1, numeroSerie: "SN-LPT-0001", nombreEquipo: "Laptop Mantenimiento" },
    { code: "LAPTOP", descripcion: "Laptop Dell Latitude 3420", marca: "Dell", modelo: "Latitude 3420", cantidad: 1, numeroSerie: "SN-LPT-0002", nombreEquipo: "Laptop Sistemas" },
    { code: "LAPTOP", descripcion: "Laptop Lenovo ThinkPad E14", marca: "Lenovo", modelo: "ThinkPad E14", cantidad: 1, numeroSerie: "SN-LPT-0003", nombreEquipo: "Laptop Disposición", estado: "DISPONIBLE" },
    { code: "ESCANER", descripcion: "Escáner Epson Perfection V39", marca: "Epson", modelo: "Perfection V39", cantidad: 1, numeroSerie: "SN-ESC-0001", nombreEquipo: "Escáner Almacén" },
  ];

  const created: Record<string, any> = {};
  const deviceById: Record<string, any> = {};
  for (const dv of devices) {
    const typeId = typeIds[dv.code];
    const type = await prisma.deviceType.findUnique({ where: { id: typeId } });
    const count = (type?.contador ?? 0) + 1;
    const controlActivos = deviceControl(type!.prefix, count);

    const device = await prisma.device.create({
      data: {
        typeId,
        controlActivos,
        descripcion: dv.descripcion,
        cantidad: dv.cantidad ?? 1,
        marca: dv.marca,
        modelo: dv.modelo,
        numeroSerie: dv.numeroSerie ?? null,
        nombreEquipo: dv.nombreEquipo ?? null,
        area: "MANTENIMIENTO",
        estado: dv.estado ?? "ASIGNADO",
      },
    });

    await prisma.deviceType.update({
      where: { id: typeId },
      data: { contador: count },
    });

    created[dv.nombreEquipo!] = device;
    deviceById[device.id] = device;
  }

  // 5) Cartas responsivas
  const cartas = [
    {
      empleado: "jperez",
      device: "Laptop Mantenimiento",
      departamento: "MANTENIMIENTO",
      fecha: daysAgo(60),
      areaBoss: "G. Domínguez",
      encargado: usuario,
      returnedBy: "",
      returnCondition: "",
      returnDays: null,
      extra: { numeroSerie: "SN-LPT-0001", nombreEquipo: "Laptop Mantenimiento" },
    },
    {
      empleado: "rgarcia",
      device: "Tablet Recepción",
      departamento: "A&B",
      fecha: daysAgo(45),
      areaBoss: "R. García",
      encargado: agarcia,
      returnedBy: "",
      returnCondition: "",
      returnDays: null,
      extra: { numeroSerie: "SN-TBE-0001", nombreEquipo: "Tablet Recepción" },
    },
    {
      empleado: "mlopez",
      device: "Laptop Sistemas",
      departamento: "RECURSOS HUMANOS",
      fecha: daysAgo(30),
      areaBoss: "M. López",
      encargado: usuario,
      returnedBy: "",
      returnCondition: "",
      returnDays: null,
      extra: { numeroSerie: "SN-LPT-0002", nombreEquipo: "Laptop Sistemas" },
    },
    {
      empleado: "lhernandez",
      device: "Impresora Almacén",
      departamento: "ALMACEN",
      fecha: daysAgo(22),
      areaBoss: "M. Pérez",
      encargado: cramirez,
      returnedBy: "",
      returnCondition: "",
      returnDays: null,
      extra: { numeroSerie: "SN-PRNT-0001", nombreEquipo: "Impresora Almacén" },
    },
    {
      empleado: "mtorres",
      device: "Escáner Almacén",
      departamento: "ALMACEN",
      fecha: daysAgo(10),
      areaBoss: "M. Pérez",
      encargado: cramirez,
      returnedBy: "",
      returnCondition: "",
      returnDays: null,
      extra: { numeroSerie: "SN-ESC-0001", nombreEquipo: "Escáner Almacén" },
    },
    {
      empleado: "cflores",
      device: "Teléfono Operaciones",
      departamento: "OPERACIONES",
      fecha: daysAgo(55),
      areaBoss: "C. Ramírez",
      encargado: agarcia,
      returnedBy: "Carla Flores",
      returnCondition: "Equipo en buen estado, sin daños",
      returnDays: 12,
      extra: { numeroSerie: "SN-TEL-0001", nombreEquipo: "Teléfono Operaciones" },
    },
    {
      empleado: "ddiaz",
      device: "Impresora Contabilidad",
      departamento: "CONTABILIDAD",
      fecha: daysAgo(40),
      areaBoss: "L. Gómez",
      encargado: agarcia,
      returnedBy: "Diego Díaz",
      returnCondition: "Presenta desgaste en la bandeja de papel",
      returnDays: 8,
      extra: { numeroSerie: "SN-PRNT-0002", nombreEquipo: "Impresora Contabilidad" },
    },
    {
      empleado: "sbaez",
      device: "Tablet Restaurant",
      departamento: "A&B",
      fecha: daysAgo(28),
      areaBoss: "R. García",
      encargado: usuario,
      returnedBy: "Sofía Báez",
      returnCondition: "Excelente estado, con funda protectora",
      returnDays: 6,
      extra: { numeroSerie: "SN-TBE-0002", nombreEquipo: "Tablet Restaurant" },
    },
  ];

  let contador = 0;
  for (const c of cartas) {
    contador += 1;
    const consecutivo = prefixNum("F-MMTO-", contador);
    const emp = empMap[c.empleado];
    const dev = created[c.device];
    const fecha = c.fecha;

    const item = {
      deviceId: dev.id,
      descripcion: dev.descripcion,
      marca: dev.marca,
      modelo: dev.modelo,
      numeroSerie: c.extra.numeroSerie,
      nombreEquipo: c.extra.nombreEquipo,
      controlActivos: dev.controlActivos,
      area: "MANTENIMIENTO",
    };

    const retournDays = c.returnDays;

    await prisma.cartaResponsiva.create({
      data: {
        consecutivo,
        fecha,
        numeroEmpleado: emp.numeroEmpleado,
        empresa: "Puerto Nuevo Hotel y Villas",
        departamento: c.departamento,
        cantidad: 1,
        creadoPorId: admin.id,
        responsableId: emp.id,
        encargadoId: c.encargado?.id ?? null,
        areaBoss: c.areaBoss,
        deliveryBy: "Departamento de Mantenimiento",
        returnDate: retournDays ? at(fecha, retournDays) : null,
        returnedBy: c.returnedBy || null,
        returnCondition: c.returnCondition || null,
        items: { create: [item] },
      },
    });

    // Estado del dispositivo: ASIGNADO si la carta sigue vigente; DISPONIBLE si fue devuelto
    await prisma.device.update({
      where: { id: dev.id },
      data: { estado: retournDays ? "DISPONIBLE" : "ASIGNADO" },
    });
  }

  // Sincroniza el consecutivo para que el siguiente folio sea correcto
  await prisma.consecutivo.update({
    where: { id: "singleton" },
    data: { contador },
  });

  console.log("✓ Seed completo:");
  console.log(`   admin      / ${adminPwd}       (ADMIN)`);
  console.log(`   agarcia    / agarcia123        (ADMIN)`);
  console.log(`   usuario    / user123           (USER)`);
  console.log(`   cramirez   / cramirez123       (USER)`);
  for (const e of empleados) {
    console.log(`   ${e.username.padEnd(10)} / ${e.username}123    (EMPLEADO)`);
  }
  console.log(`   ${departments.length} departamentos`);
  console.log(`   ${deviceTypes.length} tipos · ${devices.length} dispositivos · ${cartas.length} cartas`);
  console.log(`   Siguiente folio: F-MMTO-${String(contador + 1).padStart(4, "0")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });