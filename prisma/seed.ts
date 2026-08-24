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
  // 0) Reset de datos transaccionales
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.cartaResponsiva.deleteMany({});
  await prisma.deviceHistory.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.deviceType.updateMany({ data: { contador: 0, cartaContador: 0 } });
  await prisma.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: 0 },
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });

  // 1) Departamentos + subareas
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
    { code: "TELEFONO", name: "Telefono", prefix: "TEL" },
    { code: "IMPRESORA", name: "Impresora", prefix: "PRNT" },
    { code: "LAPTOP", name: "Laptop", prefix: "LPT" },
    { code: "ESCANER", name: "Escaner", prefix: "ESC" },
  ];

  const typeIds: Record<string, string> = {};
  for (const t of deviceTypes) {
    const type = await prisma.deviceType.upsert({
      where: { code: t.code },
      update: { name: t.name, prefix: t.prefix },
      create: { ...t, contador: 0, cartaContador: 0 },
    });
    typeIds[t.code] = type.id;
  }

  // 3) Usuarios
  const adminPwd = process.env.INITIAL_ADMIN_PASSWORD ?? "admin123";

  const upsertUser = async (u: {
    username: string;
    name: string;
    role: "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO";
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
    name: "Ana Garcia",
    role: "ADMIN",
    password: "agarcia123",
    puesto: "Gerente General",
    departmentId: deptIds["OPERACIONES"],
  });

  const usuario = await upsertUser({
    username: "usuario",
    name: "Juan Hernandez",
    role: "GERENTE",
    password: "user123",
    puesto: "Coordinador de Mantenimiento",
    departmentId: deptIds["MANTENIMIENTO"],
  });
  const cramirez = await upsertUser({
    username: "cramirez",
    name: "Carlos Ramirez",
    role: "JEFE_DE_AREA",
    password: "cramirez123",
    puesto: "Jefe de Operaciones",
    departmentId: deptIds["OPERACIONES"],
  });

  const restaurantSub = await prisma.subarea.findUnique({
    where: { departmentId_name: { departmentId: deptIds["A&B"], name: "Restaurant" } },
  });

  const empleados = [
    { username: "jperez", name: "Juan Perez", puesto: "Tecnico de Mantenimiento", numeroEmpleado: "EMP-001", departmentId: deptIds["MANTENIMIENTO"] },
    { username: "mlopez", name: "Maria Lopez", puesto: "Jefa de Sistemas", numeroEmpleado: "EMP-002", departmentId: deptIds["RECURSOS HUMANOS"] },
    { username: "rgarcia", name: "Rosa Garcia", puesto: "Coordinadora AB", numeroEmpleado: "EMP-003", departmentId: deptIds["A&B"], subareaId: restaurantSub?.id },
    { username: "lhernandez", name: "Luis Hernandez", puesto: "Almacenista", numeroEmpleado: "EMP-004", departmentId: deptIds["ALMACEN"] },
    { username: "cflores", name: "Carla Flores", puesto: "Recepcionista", numeroEmpleado: "EMP-005", departmentId: deptIds["OPERACIONES"] },
    { username: "ddiaz", name: "Diego Diaz", puesto: "Contador", numeroEmpleado: "EMP-006", departmentId: deptIds["CONTABILIDAD"] },
    { username: "sbaez", name: "Sofia Baez", puesto: "Agente de Reservaciones", numeroEmpleado: "EMP-007", departmentId: deptIds["RESERVACIONES"] },
    { username: "mtorres", name: "Miguel Torres", puesto: "Auxiliar de Compras", numeroEmpleado: "EMP-008", departmentId: deptIds["ALMACEN"] },
    { username: "fvargas", name: "Fernando Vargas", puesto: "Tecnico de Redes", numeroEmpleado: "EMP-009", departmentId: deptIds["MANTENIMIENTO"] },
    { username: "agonzalez", name: "Adriana Gonzalez", puesto: "Asistente de Marketing", numeroEmpleado: "EMP-010", departmentId: deptIds["MARKETIN"] },
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
    numeroSerie?: string;
    nombreEquipo?: string;
    area?: string;
    estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
  }> = [
    { code: "TABLE", descripcion: "Tablet Samsung Galaxy Tab A7", marca: "Samsung", modelo: "SM-T500", numeroSerie: "SN-TBE-0001", nombreEquipo: "Tablet Recepcion", area: "OPERACIONES" },
    { code: "TABLE", descripcion: "Tablet Lenovo Tab M10", marca: "Lenovo", modelo: "TB-X605", numeroSerie: "SN-TBE-0002", nombreEquipo: "Tablet Restaurant", area: "A&B" },
    { code: "TABLE", descripcion: "Tablet Huawei MatePad", marca: "Huawei", modelo: "BAH3-W09", numeroSerie: "SN-TBE-0003", nombreEquipo: "Tablet Kiosko", area: "A&B" },
    { code: "TELEFONO", descripcion: "Telefono Claro H816G", marca: "Claro", modelo: "H816G", numeroSerie: "SN-TEL-0001", nombreEquipo: "Telefono Operaciones", area: "OPERACIONES" },
    { code: "TELEFONO", descripcion: "Telefono AT&T Cingular Flex", marca: "AT&T", modelo: "Flex", numeroSerie: "SN-TEL-0002", nombreEquipo: "Telefono Call Center", area: "CALL CENTER", estado: "BAJA" },
    { code: "IMPRESORA", descripcion: "Impresora Epson L3250", marca: "Epson", modelo: "L3250", numeroSerie: "SN-PRNT-0001", nombreEquipo: "Impresoramacen", area: "ALMACEN" },
    { code: "IMPRESORA", descripcion: "Impresora HP LaserJet M404", marca: "HP", modelo: "M404dn", numeroSerie: "SN-PRNT-0002", nombreEquipo: "Impresora Contabilidad", area: "CONTABILIDAD" },
    { code: "IMPRESORA", descripcion: "Impresora Brother HL-1210", marca: "Brother", modelo: "HL-1210W", numeroSerie: "SN-PRNT-0003", nombreEquipo: "Impresora RRHH", area: "RECURSOS HUMANOS" },
    { code: "LAPTOP", descripcion: "Laptop HP ProBook 450 G8", marca: "HP", modelo: "450 G8", numeroSerie: "SN-LPT-0001", nombreEquipo: "Laptop Mantenimiento", area: "MANTENIMIENTO" },
    { code: "LAPTOP", descripcion: "Laptop Dell Latitude 3420", marca: "Dell", modelo: "Latitude 3420", numeroSerie: "SN-LPT-0002", nombreEquipo: "Laptop Sistemas", area: "RECURSOS HUMANOS" },
    { code: "LAPTOP", descripcion: "Laptop Lenovo ThinkPad E14", marca: "Lenovo", modelo: "ThinkPad E14", numeroSerie: "SN-LPT-0003", nombreEquipo: "Laptop Marketing", area: "MARKETIN" },
    { code: "ESCANER", descripcion: "Escaner Epson Perfection V39", marca: "Epson", modelo: "Perfection V39", numeroSerie: "SN-ESC-0001", nombreEquipo: "Escaner Almacen", area: "ALMACEN" },
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
        marca: dv.marca,
        modelo: dv.modelo,
        numeroSerie: dv.numeroSerie ?? null,
        nombreEquipo: dv.nombreEquipo ?? null,
        area: dv.area ?? "MANTENIMIENTO",
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

  // 5) DeviceHistory - creacion de cada dispositivo
  for (const dv of devices) {
    const dev = created[dv.nombreEquipo!];
    await prisma.deviceHistory.create({
      data: {
        deviceId: dev.id,
        type: "CREATED",
        detail: `Dispositivo registrado: ${dv.marca} ${dv.modelo}`,
        autorId: admin.id,
        createdAt: daysAgo(90),
      },
    });
  }

  // 6) Cartas responsivas
  const cartas = [
    {
      empleado: "jperez",
      device: "Laptop Mantenimiento",
      departamento: "MANTENIMIENTO",
      fecha: daysAgo(60),
      areaBoss: "G. Dominguez",
      encargado: usuario,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "rgarcia",
      device: "Tablet Recepcion",
      departamento: "A&B",
      fecha: daysAgo(45),
      areaBoss: "R. Garcia",
      encargado: agarcia,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "mlopez",
      device: "Laptop Sistemas",
      departamento: "RECURSOS HUMANOS",
      fecha: daysAgo(30),
      areaBoss: "M. Lopez",
      encargado: usuario,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "lhernandez",
      device: "Impresoramacen",
      departamento: "ALMACEN",
      fecha: daysAgo(22),
      areaBoss: "M. Perez",
      encargado: cramirez,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "mtorres",
      device: "Escaner Almacen",
      departamento: "ALMACEN",
      fecha: daysAgo(10),
      areaBoss: "M. Perez",
      encargado: cramirez,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "fvargas",
      device: "Laptop Marketing",
      departamento: "MARKETIN",
      fecha: daysAgo(35),
      areaBoss: "A. Gonzalez",
      encargado: usuario,
      returnDays: null,
      returnedBy: "",
      returnCondition: "",
    },
    {
      empleado: "cflores",
      device: "Telefono Operaciones",
      departamento: "OPERACIONES",
      fecha: daysAgo(55),
      areaBoss: "C. Ramirez",
      encargado: agarcia,
      returnDays: 12,
      returnedBy: "Carla Flores",
      returnCondition: "Equipo en buen estado, sin danos",
    },
    {
      empleado: "ddiaz",
      device: "Impresora Contabilidad",
      departamento: "CONTABILIDAD",
      fecha: daysAgo(40),
      areaBoss: "L. Gomez",
      encargado: agarcia,
      returnDays: 8,
      returnedBy: "Diego Diaz",
      returnCondition: "Presenta desgaste en la bandeja de papel",
    },
    {
      empleado: "sbaez",
      device: "Tablet Restaurant",
      departamento: "A&B",
      fecha: daysAgo(28),
      areaBoss: "R. Garcia",
      encargado: usuario,
      returnDays: 6,
      returnedBy: "Sofia Baez",
      returnCondition: "Excelente estado, con funda protectora",
    },
    {
      empleado: "agonzalez",
      device: "Impresora RRHH",
      departamento: "RECURSOS HUMANOS",
      fecha: daysAgo(18),
      areaBoss: "M. Lopez",
      encargado: usuario,
      returnDays: 4,
      returnedBy: "Adriana Gonzalez",
      returnCondition: "Funciona correctamente, sin observations",
    },
  ];

  let contador = 0;
  for (const c of cartas) {
    contador += 1;
    const consecutivo = prefixNum("F-MMTO-", contador);
    const emp = empMap[c.empleado];
    const dev = created[c.device];

    const item = {
      deviceId: dev.id,
      descripcion: dev.descripcion,
      marca: dev.marca,
      modelo: dev.modelo,
      numeroSerie: dev.numeroSerie ?? "N/A",
      nombreEquipo: dev.nombreEquipo ?? "N/A",
      controlActivos: dev.controlActivos,
      area: dev.area,
    };

    const retournDays = c.returnDays;

    await prisma.cartaResponsiva.create({
      data: {
        consecutivo,
        fecha: c.fecha,
        numeroEmpleado: emp.numeroEmpleado,
        empresa: "Puerto Nuevo Hotel y Villas",
        departamento: c.departamento,
        creadoPorId: admin.id,
        responsableId: emp.id,
        encargadoId: c.encargado?.id ?? null,
        areaBoss: c.areaBoss,
        deliveryBy: "Departamento de Mantenimiento",
        returnDate: retournDays ? at(c.fecha, retournDays) : null,
        returnedBy: c.returnedBy || null,
        returnCondition: c.returnCondition || null,
        items: { create: [item] },
      },
    });

    if (retournDays) {
      await prisma.deviceHistory.create({
        data: {
          deviceId: dev.id,
          type: "ASSIGNED",
          detail: `Asignado a ${emp.name} (${emp.puesto}) - Carta ${consecutivo}`,
          autorId: admin.id,
          createdAt: c.fecha,
        },
      });
      await prisma.deviceHistory.create({
        data: {
          deviceId: dev.id,
          type: "RETURNED",
          detail: `Devuelto por ${c.returnedBy} - ${c.returnCondition}`,
          autorId: admin.id,
          createdAt: at(c.fecha, retournDays),
        },
      });
      await prisma.device.update({
        where: { id: dev.id },
        data: { estado: "DISPONIBLE" },
      });
    } else {
      await prisma.deviceHistory.create({
        data: {
          deviceId: dev.id,
          type: "ASSIGNED",
          detail: `Asignado a ${emp.name} (${emp.puesto}) - Carta ${consecutivo}`,
          autorId: admin.id,
          createdAt: c.fecha,
        },
      });
      await prisma.device.update({
        where: { id: dev.id },
        data: { estado: "ASIGNADO" },
      });
    }
  }

  await prisma.consecutivo.update({
    where: { id: "singleton" },
    data: { contador },
  });

  // 7) Tickets con comentarios e historial
  const ticketsData = [
    {
      titulo: "Falla en impresora Epson L3250 del almacen",
      descripcion: "La impresora del almacen no enciende. Se reviso el cable de alimentacion y esta conectada correctamente. Probablemente falla de fuente de poder.",
      status: "EN_SEGUIMIENTO" as const,
      priority: "ALTA" as const,
      category: "EQUIPO" as const,
      creadoPorId: empMap["lhernandez"].id,
      asignadoAId: empMap["jperez"].id,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(5),
      comments: [
        { autorId: empMap["jperez"].id, texto: "Voy a revisarla en la tarde.", creadoEn: daysAgo(5) },
        { autorId: empMap["lhernandez"].id, texto: "Gracias, queda en el almacen principal.", creadoEn: daysAgo(5) },
        { autorId: empMap["jperez"].id, texto: "Confirmado, es la fuente de poder. Ya solicite el repuesto.", creadoEn: daysAgo(3) },
      ],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["lhernandez"].id, createdAt: daysAgo(5) },
        { type: "ASSIGNED", detail: "Asignado a Juan Perez", autorId: admin.id, createdAt: daysAgo(5) },
        { type: "STATUS", detail: "Cambiado a EN_SEGUIMIENTO", autorId: admin.id, createdAt: daysAgo(5) },
      ],
    },
    {
      titulo: "Solicitud de laptop nueva para Marketing",
      descripcion: "Se requiere una laptop nueva para el departamento de Marketing ya que la actual (Lenovo ThinkPad E14) presenta lentitud excesiva y no cumple con los requisitos para diseno grafico.",
      status: "ABIERTO" as const,
      priority: "MEDIA" as const,
      category: "EQUIPO" as const,
      creadoPorId: empMap["agonzalez"].id,
      asignadoAId: null,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(2),
      comments: [],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["agonzalez"].id, createdAt: daysAgo(2) },
        { type: "DEPARTMENT", detail: "Departamento asignado: MANTENIMIENTO", autorId: admin.id, createdAt: daysAgo(2) },
      ],
    },
    {
      titulo: "Configuracion de red Wi-Fi en Bar",
      descripcion: "El Wi-Fi del area de Bar no llega a los extremos. Los huespedes se quejan de la senal. Se necesita revisar los access points y posible instalacion de uno adicional.",
      status: "ABIERTO" as const,
      priority: "BAJA" as const,
      category: "SISTEMA" as const,
      creadoPorId: empMap["rgarcia"].id,
      asignadoAId: empMap["fvargas"].id,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(1),
      comments: [
        { autorId: empMap["fvargas"].id, texto: "Voy a revisar la cobertura del Wi-Fi hoy en la tarde.", creadoEn: daysAgo(1) },
      ],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["rgarcia"].id, createdAt: daysAgo(1) },
        { type: "ASSIGNED", detail: "Asignado a Fernando Vargas", autorId: admin.id, createdAt: daysAgo(1) },
      ],
    },
    {
      titulo: "Computadora de recepcion lenta",
      descripcion: "La computadora de recepcion tarda mas de 5 minutos en iniciar. Se ha limpiado el escritorio y se desinstalaron programas innecesarios pero sigue igual.",
      status: "CERRADO" as const,
      priority: "MEDIA" as const,
      category: "EQUIPO" as const,
      creadoPorId: empMap["cflores"].id,
      asignadoAId: empMap["mlopez"].id,
      departmentId: deptIds["OPERACIONES"],
      creadoEn: daysAgo(15),
      closedAt: daysAgo(12),
      closedBy: "mlopez",
      comments: [
        { autorId: empMap["mlopez"].id, texto: "Le voy a instalar un SSD para mejorar el rendimiento.", creadoEn: daysAgo(14) },
        { autorId: empMap["cflores"].id, texto: "Perfecto, muchas gracias.", creadoEn: daysAgo(14) },
        { autorId: empMap["mlopez"].id, texto: "Listo, ya tiene SSD. Deberia funcionar mucho mejor.", creadoEn: daysAgo(12) },
        { autorId: empMap["cflores"].id, texto: "Confirmo, ahora arranca en 30 segundos. Muchas gracias!", creadoEn: daysAgo(11) },
      ],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["cflores"].id, createdAt: daysAgo(15) },
        { type: "ASSIGNED", detail: "Asignado a Maria Lopez", autorId: admin.id, createdAt: daysAgo(15) },
        { type: "STATUS", detail: "Cambiado a EN_SEGUIMIENTO", autorId: empMap["mlopez"].id, createdAt: daysAgo(14) },
        { type: "STATUS", detail: "Cambiado a CERRADO", autorId: empMap["mlopez"].id, createdAt: daysAgo(12) },
      ],
    },
    {
      titulo: "Actualizacion del sistema de reservaciones",
      descripcion: "El sistema de reservaciones necesita actualizacion a la version 4.2. El proveedor indica que corrige bugs de calendario y mejora el rendimiento.",
      status: "EN_SEGUIMIENTO" as const,
      priority: "URGENTE" as const,
      category: "SISTEMA" as const,
      creadoPorId: empMap["sbaez"].id,
      asignadoAId: empMap["mlopez"].id,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(7),
      comments: [
        { autorId: empMap["mlopez"].id, texto: "Estoy coordinando con el proveedor para la ventana de actualizacion.", creadoEn: daysAgo(6) },
        { autorId: empMap["sbaez"].id, texto: "Podemos hacerlo en fin de semana para no afectar operaciones?", creadoEn: daysAgo(6) },
        { autorId: empMap["mlopez"].id, texto: "Si, esta programada para este sabado a las 2am.", creadoEn: daysAgo(4) },
        { autorId: empMap["sbaez"].id, texto: "Perfecto, quedo pendiente.", creadoEn: daysAgo(4) },
      ],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["sbaez"].id, createdAt: daysAgo(7) },
        { type: "ASSIGNED", detail: "Asignado a Maria Lopez", autorId: admin.id, createdAt: daysAgo(7) },
        { type: "STATUS", detail: "Cambiado a EN_SEGUIMIENTO", autorId: empMap["mlopez"].id, createdAt: daysAgo(6) },
        { type: "PRIORITY", detail: "Prioridad cambiada a URGENTE", autorId: admin.id, createdAt: daysAgo(5) },
      ],
    },
    {
      titulo: "Fuga de agua en-area de alberca",
      descripcion: "Se detecto una fuga de agua cerca de la alberca techada. El agua se esta esparciendo por el piso y representa un riesgo para los huespedes.",
      status: "ABIERTO" as const,
      priority: "URGENTE" as const,
      category: "MANTENIMIENTO" as const,
      creadoPorId: empMap["rgarcia"].id,
      asignadoAId: empMap["jperez"].id,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(0),
      comments: [],
      history: [
        { type: "CREATED", detail: "Ticket abierto - URGENTE", autorId: empMap["rgarcia"].id, createdAt: daysAgo(0) },
        { type: "ASSIGNED", detail: "Asignado a Juan Perez", autorId: admin.id, createdAt: daysAgo(0) },
      ],
    },
    {
      titulo: "Impresora HP no imprime a color",
      descripcion: "La impresora HP LaserJet M404 de Contabilidad solo imprime en blanco y negro. Se cambio el cartucho de color pero el problema persiste.",
      status: "EN_SEGUIMIENTO" as const,
      priority: "MEDIA" as const,
      category: "EQUIPO" as const,
      creadoPorId: empMap["ddiaz"].id,
      asignadoAId: empMap["jperez"].id,
      departmentId: deptIds["MANTENIMIENTO"],
      creadoEn: daysAgo(3),
      comments: [
        { autorId: empMap["jperez"].id, texto: "Voy a revisar los cartuchos y la configuracion de la impresora.", creadoEn: daysAgo(3) },
        { autorId: empMap["ddiaz"].id, texto: "Gracias, lo urgente es que necesito imprimir un reporte a color esta semana.", creadoEn: daysAgo(2) },
      ],
      history: [
        { type: "CREATED", detail: "Ticket abierto", autorId: empMap["ddiaz"].id, createdAt: daysAgo(3) },
        { type: "ASSIGNED", detail: "Asignado a Juan Perez", autorId: admin.id, createdAt: daysAgo(3) },
        { type: "STATUS", detail: "Cambiado a EN_SEGUIMIENTO", autorId: empMap["jperez"].id, createdAt: daysAgo(3) },
      ],
    },
  ];

  for (const t of ticketsData) {
    const ticket = await prisma.ticket.create({
      data: {
        titulo: t.titulo,
        descripcion: t.descripcion,
        status: t.status,
        priority: t.priority,
        category: t.category,
        creadoPorId: t.creadoPorId,
        asignadoAId: t.asignadoAId,
        departmentId: t.departmentId,
        closedAt: (t as any).closedAt ?? null,
        closedBy: (t as any).closedBy ?? null,
        creadoEn: t.creadoEn,
      },
    });

    for (const c of t.comments) {
      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          autorId: c.autorId,
          texto: c.texto,
          creadoEn: c.creadoEn,
        },
      });
    }

    for (const h of t.history) {
      await prisma.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: h.type,
          detail: h.detail,
          autorId: h.autorId,
          createdAt: h.createdAt,
        },
      });
    }
  }

  console.log("Seed completo:");
  console.log(`  admin      / ${adminPwd}       (ADMIN)`);
  console.log(`  agarcia    / agarcia123        (ADMIN)`);
  console.log(`  usuario    / user123           (GERENTE)`);
  console.log(`  cramirez   / cramirez123       (JEFE_DE_AREA)`);
  for (const e of empleados) {
    console.log(`  ${e.username.padEnd(12)} / ${e.username}123    (EMPLEADO)`);
  }
  console.log(`  ${departments.length} departamentos`);
  console.log(`  ${deviceTypes.length} tipos - ${devices.length} dispositivos - ${cartas.length} cartas - ${ticketsData.length} tickets`);
  console.log(`  Siguiente folio: F-MMTO-${String(contador + 1).padStart(4, "0")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
