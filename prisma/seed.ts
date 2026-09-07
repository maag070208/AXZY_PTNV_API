import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

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

const formatControl = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

const formatConsecutivo = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, "0")}`;

const EMPRESA_DEFAULT = "Puerto Nuevo Hotel y Villas";
const CONSECUTIVO_PREFIJO = "F-MMTO-";
const DEFAULT_EMPLOYEE_PASSWORD = process.env.SEED_EMPLOYEE_PASSWORD ?? "ptnv2026";

// ---------------------------------------------------------------------------
// 1) Roster real de empleados administrativos (fuente: "LISTA ASISTENCIA 2026"
//    hoja "ADMINISTRATIVOS AGOSTO 26"). 14 departamentos reales, sin subareas
//    inventadas. numeroEmpleado = número real de asistencia/gafete.
// ---------------------------------------------------------------------------
interface EmpleadoSeed {
  numeroEmpleado: string;
  name: string;
  departamento: string;
}

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

const EMPLEADOS: EmpleadoSeed[] = [
  { numeroEmpleado: "657", name: "Gonzalez Martinez Rafael", departamento: "RECEPCION" },
  { numeroEmpleado: "359", name: "Gallardo Aguilar Eduardo Armando", departamento: "RESERVACIONES" },
  { numeroEmpleado: "562", name: "Valenzuela Valdez Miguel Angel", departamento: "RESERVACIONES" },
  { numeroEmpleado: "646", name: "Gallardo Rosales Jesse John", departamento: "RESERVACIONES" },
  { numeroEmpleado: "570", name: "Hernandez Ponce Ana Cecilia", departamento: "EVENTOS Y BODAS" },
  { numeroEmpleado: "1", name: "Alvarado Medina Florentina", departamento: "EVENTOS Y BODAS" },
  { numeroEmpleado: "401", name: "Aragon Castro Raul Serafin", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "579", name: "Meda Anaya Rosalba", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "603", name: "Trujillo Gallegos Marco Antonio", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "612", name: "Urbieta Ainslie Javier", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "685", name: "Flores Paleta Adriana", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "700", name: "Torres Moreno Horacio", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "707", name: "Trujillo Gallegos Abrham Israel", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "712", name: "Palma Perez Ana Deyvi", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "742", name: "Wendy Alejandra Sosa Chavez", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "804", name: "Borquez Ortiz Danna Paola", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "886", name: "Cabanillas Gaeta Cytlaly", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "916", name: "Coronado Torres Juana Ines", departamento: "ADMINISTRACION" },
  { numeroEmpleado: "891", name: "Anabel Medrano Marquez", departamento: "ALMACEN" },
  { numeroEmpleado: "2", name: "Layla Ponce Torres", departamento: "ALMACEN" },
  { numeroEmpleado: "659", name: "Buendia Orozco Margarita", departamento: "SPA" },
  { numeroEmpleado: "765", name: "Castro Benitez Juan Ramon", departamento: "MANTENIMIENTO" },
  { numeroEmpleado: "789", name: "Aguilar Orduño Karla Nayelli", departamento: "ALIMENTOS Y BEBIDAS" },
  { numeroEmpleado: "790", name: "Rendon Morales Edwin Allen", departamento: "ALIMENTOS Y BEBIDAS" },
  { numeroEmpleado: "836", name: "Cuevas Cuevas Eliezer", departamento: "SISTEMAS" },
  { numeroEmpleado: "745", name: "Murillo Guerrero Jose Angel", departamento: "SEGURIDAD" },
  { numeroEmpleado: "88", name: "Cruz Cortes Lucas", departamento: "CABALLERIZAS" },
];

// ---------------------------------------------------------------------------
// 2) Tipos de dispositivo
// ---------------------------------------------------------------------------
const DEVICE_TYPES = [
  { code: "LAPTOP", prefix: "LPT", name: "Laptop" },
  { code: "PC", prefix: "PCE", name: "PC de escritorio" },
  { code: "TABLET", prefix: "TBE", name: "Tablet" },
  { code: "IMPRESORA", prefix: "PRN", name: "Impresora" },
  { code: "TELEFONO", prefix: "TEL", name: "Teléfono" },
];

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_RESET) {
    console.log(`Seed omitido: la BD ya tiene ${existingUsers} usuarios.`);
    console.log(`  Para forzar el reset: FORCE_RESET=1 npx prisma db seed`);
    return;
  }

  // -------------------------------------------------------------------------
  // Reset de datos (orden respeta FKs)
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
  await prisma.user.deleteMany({ where: { username: { not: "admin" } } });
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
  const locationsData = [
    { lugar: "BODEGA", subLugar: null, numero: null, descripcion: "Bodega principal de equipos" },
    { lugar: "OFICINA", subLugar: "SISTEMAS", numero: null, descripcion: "Oficina del departamento de sistemas" },
    { lugar: "OFICINA", subLugar: "ADMINISTRACION", numero: null, descripcion: "Oficinas administrativas" },
    { lugar: "RECEPCION", subLugar: null, numero: null, descripcion: "Área de recepción principal" },
  ];
  const locByName: Record<string, { id: string }> = {};
  for (const loc of locationsData) {
    const created = await prisma.location.create({ data: loc });
    const key = [loc.lugar, loc.subLugar, loc.numero].filter(Boolean).join("-");
    locByName[key] = created;
  }

  // -------------------------------------------------------------------------
  // Departamentos reales (sin subareas inventadas)
  // -------------------------------------------------------------------------
  const deptByName: Record<string, { id: string }> = {};
  for (const name of DEPARTAMENTOS) {
    deptByName[name] = await prisma.department.create({ data: { name, active: true } });
  }

  // -------------------------------------------------------------------------
  // Tipos de dispositivo
  // -------------------------------------------------------------------------
  const typeByCode: Record<string, { id: string; prefix: string; contador: number }> = {};
  for (const t of DEVICE_TYPES) {
    const created = await prisma.deviceType.create({
      data: { code: t.code, prefix: t.prefix, name: t.name, contador: 0, cartaContador: 0, active: true },
    });
    typeByCode[t.code] = { id: created.id, prefix: created.prefix, contador: 0 };
  }

  const nextControlActivo = async (code: string): Promise<string> => {
    const t = typeByCode[code];
    t.contador += 1;
    await prisma.deviceType.update({ where: { id: t.id }, data: { contador: t.contador } });
    return formatControl(t.prefix, t.contador);
  };

  // -------------------------------------------------------------------------
  // Admin base del sistema
  // -------------------------------------------------------------------------
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
      departmentId: deptByName["SISTEMAS"].id,
    },
    create: {
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

  // -------------------------------------------------------------------------
  // Empleados reales -> Usuarios (EMPLEADO, excepto Eliezer/SISTEMAS -> ADMIN)
  // -------------------------------------------------------------------------
  const hashedEmployeePwd = await bcrypt.hash(DEFAULT_EMPLOYEE_PASSWORD, 10);
  const userByNumEmpleado: Record<string, { id: string; name: string; departamento: string }> = {};
  for (const e of EMPLEADOS) {
    const isEliezer = e.numeroEmpleado === "836";
    const username = `u${e.numeroEmpleado}`;
    const user = await prisma.user.create({
      data: {
        username,
        name: e.name,
        role: isEliezer ? "ADMIN" : "EMPLEADO",
        active: true,
        puesto: isEliezer ? "Jefe de Sistemas" : "Empleado",
        numeroEmpleado: e.numeroEmpleado,
        empresa: EMPRESA_DEFAULT,
        departmentId: deptByName[e.departamento].id,
        password: hashedEmployeePwd,
      },
    });
    userByNumEmpleado[e.numeroEmpleado] = { id: user.id, name: user.name, departamento: e.departamento };
  }

  // -------------------------------------------------------------------------
  // Consecutivo de cartas responsivas (legado, prefijo F-MMTO-)
  // -------------------------------------------------------------------------
  let consecutivoContador = 0;
  const emitirCarta = async (opts: {
    device: { id: string; descripcion: string; marca: string; modelo: string; numeroSerie: string | null; nombreEquipo: string | null; controlActivos: string };
    numeroEmpleado: string;
    responsableId: string;
    departamento: string;
    fecha: Date;
  }) => {
    consecutivoContador += 1;
    const folio = formatConsecutivo(CONSECUTIVO_PREFIJO, consecutivoContador);
    await prisma.cartaResponsiva.create({
      data: {
        consecutive: folio,
        fecha: opts.fecha,
        numeroEmpleado: opts.numeroEmpleado,
        empresa: EMPRESA_DEFAULT,
        departamento: opts.departamento,
        creadoPorId: admin.id,
        responsableId: opts.responsableId,
        deliveryBy: "Departamento de Sistemas",
        items: {
          create: [
            {
              deviceId: opts.device.id,
              descripcion: opts.device.descripcion,
              marca: opts.device.marca,
              modelo: opts.device.modelo,
              numeroSerie: opts.device.numeroSerie ?? "N/A",
              nombreEquipo: opts.device.nombreEquipo ?? "N/A",
              controlActivos: opts.device.controlActivos,
              area: opts.departamento,
            },
          ],
        },
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        deviceId: opts.device.id,
        tipo: "SALIDA",
        notas: `Salida por carta responsiva ${folio}`,
        userId: admin.id,
        createdAt: opts.fecha,
      },
    });
    await prisma.device.update({ where: { id: opts.device.id }, data: { estado: "ASIGNADO" } });
    return folio;
  };

  // -------------------------------------------------------------------------
  // Alta de un lote de dispositivos idénticos (misma loteId, specs compartidas)
  // -------------------------------------------------------------------------
  interface UnidadPlan {
    numeroSerie: string;
    nombreEquipo: string;
    ip?: string | null;
    macAddress?: string | null;
    estado: "DISPONIBLE" | "ASIGNADO" | "BAJA";
    asignadoA?: string; // numeroEmpleado
    motivoBaja?: string;
  }

  const altaLote = async (opts: {
    code: string;
    descripcion: string;
    marca: string;
    modelo: string;
    sistemaOp?: string;
    ram?: string;
    almacenamiento?: string;
    locationKey: string;
    unidades: UnidadPlan[];
    fechaAlta: Date;
  }) => {
    const loteId = opts.unidades.length > 1 ? randomUUID() : null;
    const created: Array<{ id: string; controlActivos: string; descripcion: string; marca: string; modelo: string; numeroSerie: string | null; nombreEquipo: string | null }> = [];

    for (const u of opts.unidades) {
      const controlActivos = await nextControlActivo(opts.code);
      const device = await prisma.device.create({
        data: {
          typeId: typeByCode[opts.code].id,
          controlActivos,
          descripcion: opts.descripcion,
          marca: opts.marca,
          modelo: opts.modelo,
          numeroSerie: u.numeroSerie,
          nombreEquipo: u.nombreEquipo,
          area: u.asignadoA ? userByNumEmpleado[u.asignadoA].departamento : "SISTEMAS",
          estado: u.estado === "BAJA" ? "DISPONIBLE" : u.estado, // se da de baja después del alta, como en la vida real
          locationId: locByName[opts.locationKey]?.id ?? null,
          ip: u.ip ?? null,
          macAddress: u.macAddress ?? null,
          sistemaOp: opts.sistemaOp ?? null,
          ram: opts.ram ?? null,
          almacenamiento: opts.almacenamiento ?? null,
          loteId,
        },
      });
      created.push(device);

      await prisma.inventoryMovement.create({
        data: {
          deviceId: device.id,
          tipo: "ENTRADA",
          locationId: locByName[opts.locationKey]?.id ?? null,
          notas: `Alta en inventario: ${opts.descripcion} (${controlActivos})`,
          userId: admin.id,
          createdAt: opts.fechaAlta,
        },
      });
    }

    // Segunda pasada: asignaciones y bajas (para que quede el historial ENTRADA -> SALIDA/BAJA)
    for (let i = 0; i < opts.unidades.length; i++) {
      const u = opts.unidades[i];
      const device = created[i];
      if (u.estado === "ASIGNADO" && u.asignadoA) {
        const empleado = userByNumEmpleado[u.asignadoA];
        await emitirCarta({
          device,
          numeroEmpleado: u.asignadoA,
          responsableId: empleado.id,
          departamento: empleado.departamento,
          fecha: at(opts.fechaAlta, 3 + i),
        });
      } else if (u.estado === "BAJA") {
        await prisma.inventoryMovement.create({
          data: {
            deviceId: device.id,
            tipo: "BAJA",
            notas: u.motivoBaja ?? "Baja de equipo",
            motivoBaja: u.motivoBaja ?? "Equipo dañado",
            userId: admin.id,
            createdAt: at(opts.fechaAlta, 5 + i),
          },
        });
        await prisma.device.update({ where: { id: device.id }, data: { estado: "BAJA" } });
      }
    }

    return created;
  };

  // -------------------------------------------------------------------------
  // Lote 1: 15 tablets Samsung Galaxy Tab A9
  // -------------------------------------------------------------------------
  const tabletAsignaciones = ["657", "359", "570", "401", "685", "891", "659", "789", "745", "88"];
  const tabletUnidades: UnidadPlan[] = Array.from({ length: 15 }, (_, i) => {
    const n = i + 1;
    const octet = String(n).padStart(2, "0");
    let estado: UnidadPlan["estado"] = "DISPONIBLE";
    let asignadoA: string | undefined;
    if (n <= 10) {
      estado = "ASIGNADO";
      asignadoA = tabletAsignaciones[n - 1];
    } else if (n === 15) {
      estado = "BAJA";
    }
    return {
      numeroSerie: `SN-TBE-A9-${String(n).padStart(4, "0")}`,
      nombreEquipo: `Tablet A9 ${n}`,
      ip: `192.168.30.${100 + n}`,
      macAddress: `8C:79:F4:B0:00:${octet}`,
      estado,
      asignadoA,
      motivoBaja: estado === "BAJA" ? "Pantalla rota, no enciende" : undefined,
    };
  });

  await altaLote({
    code: "TABLET",
    descripcion: "Tablet Samsung Galaxy Tab A9",
    marca: "Samsung",
    modelo: "SM-X210",
    sistemaOp: "Android 14",
    ram: "4 GB",
    almacenamiento: "64 GB",
    locationKey: "BODEGA",
    unidades: tabletUnidades,
    fechaAlta: daysAgo(25),
  });

  // -------------------------------------------------------------------------
  // Lote 2: 5 PC de escritorio Lenovo ThinkCentre M720
  // -------------------------------------------------------------------------
  const pcAsignaciones = ["612", "603", "836"];
  const pcUnidades: UnidadPlan[] = Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const octet = String(n).padStart(2, "0");
    const asignadoA = n <= 3 ? pcAsignaciones[n - 1] : undefined;
    return {
      numeroSerie: `SN-PCE-M720-${String(n).padStart(4, "0")}`,
      nombreEquipo: `PC Administracion ${n}`,
      ip: `192.168.10.${40 + n}`,
      macAddress: `E4:54:E8:2A:00:${octet}`,
      estado: (asignadoA ? "ASIGNADO" : "DISPONIBLE") as UnidadPlan["estado"],
      asignadoA,
    };
  });

  await altaLote({
    code: "PC",
    descripcion: "PC de escritorio Lenovo ThinkCentre M720",
    marca: "Lenovo",
    modelo: "ThinkCentre M720",
    sistemaOp: "Windows 11 Pro",
    ram: "16 GB",
    almacenamiento: "512 GB SSD NVMe",
    locationKey: "OFICINA-ADMINISTRACION",
    unidades: pcUnidades,
    fechaAlta: daysAgo(20),
  });

  // -------------------------------------------------------------------------
  // Lote 3: 3 laptops HP ProBook 450 G8
  // -------------------------------------------------------------------------
  const laptopAsignaciones = ["700", "765"];
  const laptopUnidades: UnidadPlan[] = Array.from({ length: 3 }, (_, i) => {
    const n = i + 1;
    const octet = String(n).padStart(2, "0");
    const asignadoA = n <= 2 ? laptopAsignaciones[n - 1] : undefined;
    return {
      numeroSerie: `SN-LPT-450-${String(n).padStart(4, "0")}`,
      nombreEquipo: `Laptop ${n}`,
      ip: `192.168.10.${50 + n}`,
      macAddress: `00:1A:2B:4C:00:${octet}`,
      estado: (asignadoA ? "ASIGNADO" : "DISPONIBLE") as UnidadPlan["estado"],
      asignadoA,
    };
  });

  await altaLote({
    code: "LAPTOP",
    descripcion: "Laptop HP ProBook 450 G8",
    marca: "HP",
    modelo: "450 G8",
    sistemaOp: "Windows 11 Pro",
    ram: "16 GB",
    almacenamiento: "512 GB SSD NVMe",
    locationKey: "OFICINA-SISTEMAS",
    unidades: laptopUnidades,
    fechaAlta: daysAgo(18),
  });

  // -------------------------------------------------------------------------
  // Impresoras (altas individuales, no forman lote real)
  // -------------------------------------------------------------------------
  await altaLote({
    code: "IMPRESORA",
    descripcion: "Impresora Epson L3250",
    marca: "Epson",
    modelo: "L3250",
    locationKey: "BODEGA",
    unidades: [{ numeroSerie: "SN-PRN-0001", nombreEquipo: "Impresora Bodega", estado: "DISPONIBLE" }],
    fechaAlta: daysAgo(15),
  });
  await altaLote({
    code: "IMPRESORA",
    descripcion: "Impresora HP LaserJet M404",
    marca: "HP",
    modelo: "M404dn",
    locationKey: "OFICINA-ADMINISTRACION",
    unidades: [{ numeroSerie: "SN-PRN-0002", nombreEquipo: "Impresora Administracion", estado: "ASIGNADO", asignadoA: "916" }],
    fechaAlta: daysAgo(15),
  });

  // -------------------------------------------------------------------------
  // Teléfonos (altas individuales)
  // -------------------------------------------------------------------------
  await altaLote({
    code: "TELEFONO",
    descripcion: "Teléfono Samsung Galaxy A15",
    marca: "Samsung",
    modelo: "SM-A155",
    locationKey: "OFICINA-ADMINISTRACION",
    unidades: [{ numeroSerie: "SN-TEL-0001", nombreEquipo: "Telefono Administracion 1", estado: "ASIGNADO", asignadoA: "742" }],
    fechaAlta: daysAgo(10),
  });
  await altaLote({
    code: "TELEFONO",
    descripcion: "Teléfono Samsung Galaxy A15",
    marca: "Samsung",
    modelo: "SM-A155",
    locationKey: "OFICINA-ADMINISTRACION",
    unidades: [{ numeroSerie: "SN-TEL-0002", nombreEquipo: "Telefono A&B 1", estado: "ASIGNADO", asignadoA: "790" }],
    fechaAlta: daysAgo(10),
  });

  // -------------------------------------------------------------------------
  // Salidas de material (Bitácora de Salida de Material, F-SIS-0005)
  // -------------------------------------------------------------------------
  const salidas = [
    { dias: 22, descripcion: "Cable de red UTP Cat6 (rollo)", marca: "Steren", modelo: "C6-100", cantidad: 1, departamento: "ADMINISTRACION", usuario: "Cuevas Cuevas Eliezer" },
    { dias: 20, descripcion: "Tóner para impresora HP LaserJet M404", marca: "HP", modelo: "CF230A", cantidad: 2, departamento: "ADMINISTRACION", usuario: "Coronado Torres Juana Ines" },
    { dias: 18, descripcion: "Mouse inalámbrico", marca: "Logitech", modelo: "M170", cantidad: 3, departamento: "RECEPCION", usuario: "Gonzalez Martinez Rafael" },
    { dias: 15, descripcion: "Teclado USB", marca: "Logitech", modelo: "K120", cantidad: 2, departamento: "RESERVACIONES", usuario: "Gallardo Aguilar Eduardo Armando" },
    { dias: 12, descripcion: "Cargador USB-C 20W", marca: "Samsung", modelo: "EP-T2510", cantidad: 4, departamento: "SISTEMAS", usuario: "Cuevas Cuevas Eliezer" },
    { dias: 9, descripcion: "Extensión eléctrica 5 tomas", marca: "Steren", modelo: "MUL-505", cantidad: 2, departamento: "EVENTOS Y BODAS", usuario: "Hernandez Ponce Ana Cecilia" },
    { dias: 6, descripcion: "Adaptador HDMI a VGA", marca: "Ugreen", modelo: "40248", cantidad: 1, departamento: "ADMINISTRACION", usuario: "Torres Moreno Horacio" },
    { dias: 3, descripcion: "Batería recargable AA (paquete 4)", marca: "Duracell", modelo: "DX1500", cantidad: 5, departamento: "SEGURIDAD", usuario: "Murillo Guerrero Jose Angel" },
  ];
  for (const s of salidas) {
    await prisma.materialOutput.create({
      data: {
        fecha: daysAgo(s.dias),
        descripcion: s.descripcion,
        marca: s.marca,
        modelo: s.modelo,
        cantidad: s.cantidad,
        departamento: s.departamento,
        usuario: s.usuario,
        area: "Sistemas",
        registradoPorId: admin.id,
        createdAt: daysAgo(s.dias),
      },
    });
  }

  await prisma.consecutivo.update({ where: { id: "singleton" }, data: { contador: consecutivoContador } });

  const totalDevices = 15 + 5 + 3 + 2 + 2;
  console.log("Seed completo:");
  console.log(`  ${locationsData.length} ubicaciones`);
  console.log(`  ${DEPARTAMENTOS.length} departamentos reales (sin subareas)`);
  console.log(`  ${EMPLEADOS.length + 1} usuarios (admin + ${EMPLEADOS.length} empleados reales, Eliezer=ADMIN)`);
  console.log(`  ${DEVICE_TYPES.length} tipos de dispositivo (TABLET corregido, + TELEFONO nuevo)`);
  console.log(`  ${totalDevices} dispositivos en 3 lotes (15 tablets + 5 PCs + 3 laptops) + 2 impresoras + 2 teléfonos`);
  console.log(`  ${consecutivoContador} cartas responsivas (F-MMTO-0001..${formatConsecutivo(CONSECUTIVO_PREFIJO, consecutivoContador)})`);
  console.log(`  ${salidas.length} salidas de material`);
  console.log("");
  console.log(`  Login admin: admin / ${adminPwd}`);
  console.log(`  Login empleados: u<numeroEmpleado> / ${DEFAULT_EMPLOYEE_PASSWORD}  (ej. u836 = Eliezer, ADMIN)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
