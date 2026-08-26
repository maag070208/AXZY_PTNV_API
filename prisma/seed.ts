import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const at = (base: Date, addDays: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  return d;
};

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

const deviceControl = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

const EMPRESA_DEFAULT = "Puerto Nuevo Hotel y Villas";

async function main() {
  // 0) Idempotencia: si ya hay datos en la BD, no re-sembramos.
  //    Esto evita que cada arranque del contenedor api borre producción.
  //    Para forzar el reset: FORCE_RESET=1 npx prisma db seed
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    console.log(`Seed omitido: la BD ya tiene ${existingUsers} usuarios.`);
    console.log(`  Para forzar el reset: FORCE_RESET=1 npx prisma db seed`);
    return;
  }

  // 1) Reset de datos transaccionales
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.cartaResponsiva.deleteMany({});
  await prisma.deviceHistory.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.location.deleteMany({});
  // Limpieza de users antes de subareas/departments (FK)
  await prisma.user.deleteMany({ where: { username: { not: "admin" } } });
  await prisma.subarea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.deviceType.updateMany({ data: { contador: 0, cartaContador: 0 } });
  await prisma.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: 0 },
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });

  // 2) Ubicaciones
  const locationsData = [
    { lugar: "BODEGA", subLugar: null, numero: null, descripcion: "Bodega principal de equipos" },
    { lugar: "ALMACEN", subLugar: "CAJAS", numero: null, descripcion: "Estantes con cajas de equipo" },
    { lugar: "OFICINA", subLugar: "SISTEMAS", numero: null, descripcion: "Oficina del departamento de sistemas" },
    { lugar: "OFICINA", subLugar: "CONTABILIDAD", numero: "1", descripcion: "Escritorio 1 contabilidad" },
    { lugar: "OFICINA", subLugar: "CONTABILIDAD", numero: "2", descripcion: "Escritorio 2 contabilidad" },
    { lugar: "RECEPCION", subLugar: null, numero: null, descripcion: "Area de recepcion principal" },
    { lugar: "RESTAURANT", subLugar: "BAR", numero: null, descripcion: "Area del bar" },
    { lugar: "MANTENIMIENTO", subLugar: "TALLER", numero: null, descripcion: "Taller de mantenimiento" },
  ];

  const locByName: Record<string, any> = {};
  for (const loc of locationsData) {
    const created = await prisma.location.create({ data: loc });
    const key = [loc.lugar, loc.subLugar, loc.numero].filter(Boolean).join("-");
    locByName[key] = created;
  }

  // 3) Departamentos y subareas
  const departmentsData = [
    { name: "OPERACIONES", subareas: ["Sistemas", "Recepción"] },
    { name: "A&B", subareas: ["Restaurant", "Bar", "Cocina"] },
    { name: "MANTENIMIENTO", subareas: ["Taller", "Preventivo"] },
    { name: "SISTEMAS", subareas: ["Redes", "Soporte"] },
    { name: "RECEPCION", subareas: ["Hotel", "Tarde", "Noche"] },
    { name: "CONTABILIDAD", subareas: ["Cuentas", "Nómina"] },
  ];

  const deptByName: Record<string, any> = {};
  const subareaByName: Record<string, any> = {};
  for (const d of departmentsData) {
    const dept = await prisma.department.create({ data: { name: d.name, active: true } });
    deptByName[d.name] = dept;
    for (const sn of d.subareas) {
      const sub = await prisma.subarea.create({
        data: { name: sn, departmentId: dept.id, active: true },
      });
      subareaByName[`${d.name}/${sn}`] = sub;
    }
  }

  // 4) Tipos de dispositivo
  const deviceTypes = [
    { code: "LAPTOP", prefix: "LPT", name: "Laptop" },
    { code: "PC", prefix: "PCE", name: "PC de escritorio" },
    { code: "TABLE", prefix: "TBE", name: "Tablet" },
    { code: "IMPRESORA", prefix: "PRN", name: "Impresora" },
  ];

  const typeIds: Record<string, string> = {};
  for (const t of deviceTypes) {
    let type = await prisma.deviceType.findUnique({ where: { code: t.code } });
    if (!type) {
      type = await prisma.deviceType.create({
        data: { code: t.code, prefix: t.prefix, name: t.name, contador: 0, cartaContador: 0, active: true },
      });
    } else {
      await prisma.deviceType.update({
        where: { id: type.id },
        data: { contador: 0, cartaContador: 0 },
      });
    }
    typeIds[t.code] = type.id;
  }

  // 5) Admin base (antes de devices para usarlo en movimientos de inventario)
  const adminPwd = process.env.INITIAL_ADMIN_PASSWORD ?? "admin123";
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      name: "Administrador",
      role: "ADMIN",
      active: true,
      puesto: "Director TI",
      numeroEmpleado: "EMP-001",
      empresa: EMPRESA_DEFAULT,
      departmentId: deptByName["SISTEMAS"]?.id ?? null,
      subareaId: subareaByName["SISTEMAS/Soporte"]?.id ?? null,
    },
    create: {
      username: "admin",
      name: "Administrador",
      role: "ADMIN",
      active: true,
      puesto: "Director TI",
      numeroEmpleado: "EMP-001",
      empresa: EMPRESA_DEFAULT,
      departmentId: deptByName["SISTEMAS"]?.id ?? null,
      subareaId: subareaByName["SISTEMAS/Soporte"]?.id ?? null,
      password: await bcrypt.hash(adminPwd, 10),
    },
  });

  // 6) Crear dispositivos y movimientos de ENTRADA
  //    Los tipos LAPTOP / PC / TABLE admiten specs TIC (IP, MAC, SO, RAM, almacenamiento).
  //    IMPRESORA y otros tipos NO-TIC quedan sin specs.
  const devicesData = [
    {
      code: "LAPTOP",
      descripcion: "Laptop HP ProBook 450 G8",
      marca: "HP",
      modelo: "450 G8",
      numeroSerie: "SN-LPT-0001",
      nombreEquipo: "Laptop Administracion",
      locationKey: "OFICINA-SISTEMAS",
      it: {
        ip: "192.168.10.21",
        macAddress: "00:1A:2B:3C:4D:5E",
        sistemaOp: "Windows 11 Pro",
        ram: "16 GB",
        almacenamiento: "512 GB SSD NVMe",
      },
    },
    {
      code: "LAPTOP",
      descripcion: "Laptop Dell Latitude 3420",
      marca: "Dell",
      modelo: "Latitude 3420",
      numeroSerie: "SN-LPT-0002",
      nombreEquipo: "Laptop Recepcion",
      locationKey: "RECEPCION",
      it: {
        ip: "192.168.10.22",
        macAddress: "00:1A:2B:3C:4D:5F",
        sistemaOp: "Windows 10 Pro",
        ram: "8 GB",
        almacenamiento: "256 GB SSD",
      },
    },
    {
      code: "PC",
      descripcion: "PC de escritorio Lenovo ThinkCentre M720",
      marca: "Lenovo",
      modelo: "ThinkCentre M720",
      numeroSerie: "SN-PCE-0001",
      nombreEquipo: "PC Contabilidad 1",
      locationKey: "OFICINA-CONTABILIDAD-1",
      it: {
        ip: "192.168.10.30",
        macAddress: "E4:54:E8:1A:2B:3C",
        sistemaOp: "Windows 11 Pro",
        ram: "32 GB",
        almacenamiento: "1 TB SSD NVMe + 2 TB HDD",
      },
    },
    {
      code: "PC",
      descripcion: "PC de escritorio HP EliteDesk 800 G6",
      marca: "HP",
      modelo: "EliteDesk 800 G6",
      numeroSerie: "SN-PCE-0002",
      nombreEquipo: "PC Recepcion",
      locationKey: "RECEPCION",
      it: {
        ip: "192.168.10.31",
        macAddress: "E4:54:E8:1A:2B:3D",
        sistemaOp: "Windows 11 Pro",
        ram: "16 GB",
        almacenamiento: "512 GB SSD",
      },
    },
    {
      code: "TABLE",
      descripcion: "Tablet Samsung Galaxy Tab A7",
      marca: "Samsung",
      modelo: "SM-T500",
      numeroSerie: "SN-TBE-0001",
      nombreEquipo: "Tablet Restaurant",
      locationKey: "RESTAURANT-BAR",
      it: {
        ip: "192.168.20.10",
        macAddress: "8C:79:F4:A1:B2:C3",
        sistemaOp: "Android 13",
        ram: "4 GB",
        almacenamiento: "64 GB eMMC",
      },
    },
    {
      code: "TABLE",
      descripcion: "iPad Pro 11",
      marca: "Apple",
      modelo: "M2 (2022)",
      numeroSerie: "SN-TBE-0002",
      nombreEquipo: "iPad Gerencia",
      locationKey: "OFICINA-SISTEMAS",
      it: {
        ip: "192.168.20.11",
        macAddress: "A4:5E:60:F1:E2:D3",
        sistemaOp: "iPadOS 17",
        ram: "8 GB",
        almacenamiento: "256 GB SSD",
      },
    },
    {
      code: "IMPRESORA",
      descripcion: "Impresora Epson L3250",
      marca: "Epson",
      modelo: "L3250",
      numeroSerie: "SN-PRN-0001",
      nombreEquipo: "Impresora Almacen",
      locationKey: "ALMACEN-CAJAS",
      it: null,
    },
    {
      code: "IMPRESORA",
      descripcion: "Impresora HP LaserJet M404",
      marca: "HP",
      modelo: "M404dn",
      numeroSerie: "SN-PRN-0002",
      nombreEquipo: "Impresora Contabilidad",
      locationKey: "OFICINA-CONTABILIDAD-1",
      it: null,
    },
  ];

  const createdDevices: Record<string, any> = {};
  for (const dv of devicesData) {
    const typeId = typeIds[dv.code];
    const type = await prisma.deviceType.findUnique({ where: { id: typeId } });
    const count = (type?.contador ?? 0) + 1;
    const controlActivos = deviceControl(type!.prefix, count);

    const device = await prisma.device.create({
      data: {
        typeId,
        controlActivos,
        descripcion: dv.descripcion,
        marca: dv.marca,
        modelo: dv.modelo,
        numeroSerie: dv.numeroSerie ?? null,
        nombreEquipo: dv.nombreEquipo ?? null,
        area: "OPERACIONES",
        estado: "DISPONIBLE",
        locationId: locByName[dv.locationKey]?.id ?? null,
        ip: dv.it?.ip ?? null,
        macAddress: dv.it?.macAddress ?? null,
        sistemaOp: dv.it?.sistemaOp ?? null,
        ram: dv.it?.ram ?? null,
        almacenamiento: dv.it?.almacenamiento ?? null,
      },
    });
    createdDevices[dv.nombreEquipo] = device;

    await prisma.deviceType.update({
      where: { id: typeId },
      data: { contador: count },
    });

    // Movimiento de ENTRADA (alta en inventario)
    await prisma.inventoryMovement.create({
      data: {
        deviceId: device.id,
        tipo: "ENTRADA",
        locationId: locByName[dv.locationKey]?.id ?? null,
        notas: `Alta en inventario: ${dv.descripcion}`,
        userId: admin.id,
        createdAt: daysAgo(30),
      },
    });
  }

  // 7) Crear usuarios (1 ADMIN + 1 GERENTE + 2 JEFE_DE_AREA + 7 EMPLEADO)
  const upsertUser = async (u: {
    username: string;
    name: string;
    role: "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO";
    password: string;
    puesto?: string;
    numeroEmpleado?: string;
    empresa?: string;
    departmentName?: string;
    subareaName?: string;
  }) => {
    const departmentId = u.departmentName ? deptByName[u.departmentName]?.id : undefined;
    const subareaId =
      u.departmentName && u.subareaName
        ? subareaByName[`${u.departmentName}/${u.subareaName}`]?.id
        : undefined;
    return prisma.user.upsert({
      where: { username: u.username },
      update: {
        name: u.name,
        role: u.role,
        active: true,
        puesto: u.puesto ?? null,
        numeroEmpleado: u.numeroEmpleado ?? null,
        empresa: u.empresa ?? EMPRESA_DEFAULT,
        departmentId: departmentId ?? null,
        subareaId: subareaId ?? null,
      },
      create: {
        username: u.username,
        name: u.name,
        role: u.role,
        active: true,
        puesto: u.puesto,
        numeroEmpleado: u.numeroEmpleado,
        empresa: u.empresa ?? EMPRESA_DEFAULT,
        departmentId: departmentId ?? null,
        subareaId: subareaId ?? null,
        password: await bcrypt.hash(u.password, 10),
      },
    });
  };

  const empleado1 = await upsertUser({
    username: "jperez",
    name: "Juan Pérez",
    role: "EMPLEADO",
    password: "jperez123",
    puesto: "Recepcionista",
    numeroEmpleado: "EMP-005",
    departmentName: "RECEPCION",
    subareaName: "Hotel",
  });

  const empleado2 = await upsertUser({
    username: "mlopez",
    name: "María López",
    role: "EMPLEADO",
    password: "mlopez123",
    puesto: "Jefa de Salón",
    numeroEmpleado: "EMP-006",
    departmentName: "A&B",
    subareaName: "Restaurant",
  });

  // Resto del staff
  await upsertUser({
    username: "agarcia",
    name: "Ana García",
    role: "GERENTE",
    password: "agarcia123",
    puesto: "Gerente General",
    numeroEmpleado: "EMP-002",
    departmentName: "OPERACIONES",
  });
  await upsertUser({
    username: "rramirez",
    name: "Roberto Ramírez",
    role: "JEFE_DE_AREA",
    password: "rramirez123",
    puesto: "Jefe de Mantenimiento",
    numeroEmpleado: "EMP-003",
    departmentName: "MANTENIMIENTO",
    subareaName: "Taller",
  });
  await upsertUser({
    username: "mvega",
    name: "María Vega",
    role: "JEFE_DE_AREA",
    password: "mvega123",
    puesto: "Jefa de Sistemas",
    numeroEmpleado: "EMP-004",
    departmentName: "SISTEMAS",
    subareaName: "Redes",
  });
  await upsertUser({
    username: "cmendoza",
    name: "Carlos Mendoza",
    role: "EMPLEADO",
    password: "cmendoza123",
    puesto: "Barman",
    numeroEmpleado: "EMP-007",
    departmentName: "A&B",
    subareaName: "Bar",
  });
  await upsertUser({
    username: "ltorres",
    name: "Laura Torres",
    role: "EMPLEADO",
    password: "ltorres123",
    puesto: "Contadora",
    numeroEmpleado: "EMP-008",
    departmentName: "CONTABILIDAD",
    subareaName: "Cuentas",
  });
  await upsertUser({
    username: "dhernandez",
    name: "Diego Hernández",
    role: "EMPLEADO",
    password: "dhernandez123",
    puesto: "Técnico de Mantenimiento",
    numeroEmpleado: "EMP-009",
    departmentName: "MANTENIMIENTO",
    subareaName: "Preventivo",
  });
  await upsertUser({
    username: "scastillo",
    name: "Sofía Castillo",
    role: "EMPLEADO",
    password: "scastillo123",
    puesto: "Recepcionista",
    numeroEmpleado: "EMP-010",
    departmentName: "RECEPCION",
    subareaName: "Tarde",
  });
  await upsertUser({
    username: "jvargas",
    name: "José Vargas",
    role: "EMPLEADO",
    password: "jvargas123",
    puesto: "Chef",
    numeroEmpleado: "EMP-011",
    departmentName: "A&B",
    subareaName: "Cocina",
  });

  // 8) Crear carta responsiva que genera SALIDA
  const carta1 = await prisma.cartaResponsiva.create({
    data: {
      consecutive: "F-MMTO-0001",
      fecha: daysAgo(20),
      numeroEmpleado: "EMP-005",
      empresa: EMPRESA_DEFAULT,
      departamento: "RECEPCION",
      creadoPorId: admin.id,
      responsableId: empleado1.id,
      areaBoss: "M. Vega",
      deliveryBy: "Departamento de Mantenimiento",
      returnDate: at(daysAgo(20), 7),
      items: {
        create: [{
          deviceId: createdDevices["Laptop Recepcion"].id,
          descripcion: createdDevices["Laptop Recepcion"].descripcion,
          marca: createdDevices["Laptop Recepcion"].marca,
          modelo: createdDevices["Laptop Recepcion"].modelo,
          numeroSerie: createdDevices["Laptop Recepcion"].numeroSerie ?? "N/A",
          nombreEquipo: createdDevices["Laptop Recepcion"].nombreEquipo ?? "N/A",
          controlActivos: createdDevices["Laptop Recepcion"].controlActivos,
          area: "RECEPCION",
        }],
      },
    },
  });

  await prisma.inventoryMovement.create({
    data: {
      deviceId: createdDevices["Laptop Recepcion"].id,
      tipo: "SALIDA",
      locationId: null,
      notas: `Salida por carta responsiva F-MMTO-0001`,
      userId: admin.id,
      createdAt: daysAgo(20),
    },
  });

  await prisma.device.update({
    where: { id: createdDevices["Laptop Recepcion"].id },
    data: { estado: "ASIGNADO" },
  });

  // 9) Carta para Tablet Restaurant
  const carta2 = await prisma.cartaResponsiva.create({
    data: {
      consecutive: "F-MMTO-0002",
      fecha: daysAgo(15),
      numeroEmpleado: "EMP-006",
      empresa: EMPRESA_DEFAULT,
      departamento: "A&B",
      creadoPorId: admin.id,
      responsableId: empleado2.id,
      areaBoss: "R. Ramirez",
      deliveryBy: "Departamento de Mantenimiento",
      returnDate: at(daysAgo(15), 5),
      items: {
        create: [{
          deviceId: createdDevices["Tablet Restaurant"].id,
          descripcion: createdDevices["Tablet Restaurant"].descripcion,
          marca: createdDevices["Tablet Restaurant"].marca,
          modelo: createdDevices["Tablet Restaurant"].modelo,
          numeroSerie: createdDevices["Tablet Restaurant"].numeroSerie ?? "N/A",
          nombreEquipo: createdDevices["Tablet Restaurant"].nombreEquipo ?? "N/A",
          controlActivos: createdDevices["Tablet Restaurant"].controlActivos,
          area: "A&B",
        }],
      },
    },
  });

  await prisma.inventoryMovement.create({
    data: {
      deviceId: createdDevices["Tablet Restaurant"].id,
      tipo: "SALIDA",
      locationId: null,
      notas: `Salida por carta responsiva F-MMTO-0002`,
      userId: admin.id,
      createdAt: daysAgo(15),
    },
  });

  await prisma.device.update({
    where: { id: createdDevices["Tablet Restaurant"].id },
    data: { estado: "ASIGNADO" },
  });

  // 10) Sincronizar consecutivo con las cartas creadas
  await prisma.consecutivo.update({
    where: { id: "singleton" },
    data: { contador: 2 },
  });

  const totalSubareas = departmentsData.reduce((s, d) => s + d.subareas.length, 0);
  console.log("Seed completo:");
  console.log(`  ${locationsData.length} ubicaciones`);
  console.log(`  ${departmentsData.length} departamentos, ${totalSubareas} subareas`);
  console.log(`  11 usuarios (1 ADMIN + 1 GERENTE + 2 JEFE_DE_AREA + 7 EMPLEADO)`);
  console.log(`  ${devicesData.length} dispositivos (${devicesData.filter((d) => d.it).length} con specs TIC)`);
  console.log(`  2 cartas responsivas (F-MMTO-0001, F-MMTO-0002)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
