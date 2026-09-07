import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { formatPrefix } from "../device-types/device-type.service";
import { randomUUID } from "node:crypto";

// ─── Especificaciones técnicas (TIC) ────────────────────────────────
export const IT_DEVICE_CODES = ["PC", "TABLET", "LAPTOP"] as const;
export type ITDeviceCode = (typeof IT_DEVICE_CODES)[number];

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
// IPv6 (incluye ::1 y formas con doble dos puntos) — validación pragmática
const IPV6_REGEX =
  /^(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}$|^(?:[0-9A-Fa-f]{1,4}:){1,7}:$|^::1?$|^::$/;

const isITType = (code?: string | null): boolean =>
  !!code && (IT_DEVICE_CODES as readonly string[]).includes(code);

const normalizeITSpec = (
  typeCode: string | undefined | null,
  field: "ip" | "macAddress" | "sistemaOp" | "ram" | "almacenamiento",
  value: unknown
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const str = String(value).trim();
  if (str === "") return null;

  if (!isITType(typeCode)) {
    throw new HttpError(
      400,
      `El campo "${field}" solo aplica a dispositivos TIC (PC / TABLET / LAPTOP)`
    );
  }

  if (field === "macAddress" && !MAC_REGEX.test(str)) {
    throw new HttpError(
      400,
      "MAC Address inválida. Formato esperado: AA:BB:CC:DD:EE:FF o AA-BB-CC-DD-EE-FF"
    );
  }

  if (field === "ip" && !(IPV4_REGEX.test(str) || IPV6_REGEX.test(str))) {
    throw new HttpError(400, "IP inválida. Use IPv4 (192.168.0.1) o IPv6 válido");
  }

  if (field === "ram") {
    if (str.length > 40) {
      throw new HttpError(400, "RAM excede 40 caracteres");
    }
  }
  if (field === "almacenamiento" && str.length > 120) {
    throw new HttpError(400, "Almacenamiento excede 120 caracteres");
  }
  if (field === "sistemaOp" && str.length > 80) {
    throw new HttpError(400, "Sistema Operativo excede 80 caracteres");
  }

  return str;
};

export interface DeviceInput {
  typeId: string;
  descripcion: string;
  marca: string;
  modelo: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  area?: string;
  estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
  locationId?: string;
  // Especificaciones técnicas (TIC)
  ip?: string | null;
  macAddress?: string | null;
  sistemaOp?: string | null;
  ram?: string | null;
  almacenamiento?: string | null;
}

export interface DeviceBatchUnit {
  numeroSerie?: string;
  nombreEquipo?: string;
  ip?: string;
  macAddress?: string;
}

export interface DeviceBatchInput {
  typeId: string;
  descripcion: string;
  marca: string;
  modelo: string;
  area?: string;
  estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
  sistemaOp?: string;
  ram?: string;
  almacenamiento?: string;
  units: DeviceBatchUnit[];
}

const includeFull = {
  type: true,
  history: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

// Tamaño del lote (unidades dadas de alta juntas) para una lista de loteIds.
const buildLoteSizes = async (loteIds: string[]): Promise<Record<string, number>> => {
  if (loteIds.length === 0) return {};
  const grouped = await prismaClient.device.groupBy({
    by: ["loteId"],
    where: { loteId: { in: loteIds } },
    _count: { _all: true },
  });
  return Object.fromEntries(
    grouped.map((g) => [g.loteId as string, g._count._all as number])
  );
};

export const listDevices = async (filters: {
  typeId?: string;
  estado?: string;
  q?: string;
}) => {
  const where: any = {};
  if (filters.typeId) where.typeId = filters.typeId;
  if (filters.estado) where.estado = filters.estado;
  if (filters.q) {
    where.OR = [
      { descripcion: { contains: filters.q, mode: "insensitive" } },
      { marca: { contains: filters.q, mode: "insensitive" } },
      { modelo: { contains: filters.q, mode: "insensitive" } },
      { controlActivos: { contains: filters.q, mode: "insensitive" } },
      { numeroSerie: { contains: filters.q, mode: "insensitive" } },
      { ip: { contains: filters.q, mode: "insensitive" } },
      { macAddress: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  return prismaClient.device.findMany({
    where,
    include: { type: true },
    orderBy: { createdAt: "desc" },
  });
};

export const listDevicesTable = async (
  params: ITDataTableFetchParams
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: any = {};

  if (filters.typeId) where.typeId = String(filters.typeId);
  if (filters.estado) where.estado = String(filters.estado);
  if (filters.controlActivos) where.controlActivos = ci(filters.controlActivos);
  if (filters.descripcion) where.descripcion = ci(filters.descripcion);
  if (filters.marca) where.marca = ci(filters.marca);
  if (filters.modelo) where.modelo = ci(filters.modelo);
  if (filters.type) where.type = { name: ci(filters.type) };
  if (filters.q) {
    where.OR = [
      { descripcion: { contains: String(filters.q), mode: "insensitive" } },
      { marca: { contains: String(filters.q), mode: "insensitive" } },
      { modelo: { contains: String(filters.q), mode: "insensitive" } },
      { controlActivos: { contains: String(filters.q), mode: "insensitive" } },
      { numeroSerie: { contains: String(filters.q), mode: "insensitive" } },
      { ip: { contains: String(filters.q), mode: "insensitive" } },
      { macAddress: { contains: String(filters.q), mode: "insensitive" } },
    ];
  }

  const orderBy = orderByOf(
    params.sort,
    {
      controlActivos: "controlActivos",
      descripcion: "descripcion",
      estado: "estado",
      typeId: (d: "asc" | "desc") => ({ type: { name: d } }),
      createdAt: "createdAt",
    },
    [{ createdAt: "desc" }]
  );

  // Se traen todos los que cumplen el filtro y se agrupan por lote: un lote de
  // N unidades dadas de alta juntas se muestra como UN solo renglón (con su
  // cantidad), en lugar de N renglones idénticos. El renglón resultante usa el
  // identificador genérico (primera unidad del lote) y un resumen por estado.
  const all = await prismaClient.device.findMany({
    where,
    include: { type: true },
    orderBy: orderBy as any,
  });

  const loteIds = Array.from(
    new Set(all.map((d) => d.loteId).filter((v): v is string => !!v))
  );
  const loteSizes = await buildLoteSizes(loteIds);

  // Orden de renglones: conserva el orden de la consulta; cada lote aparece en
  // la posición de su primera unidad y las unidades sueltas en las suyas.
  const seenLotes = new Set<string>();
  const rows: any[] = [];
  for (const d of all) {
    if (d.loteId) {
      if (seenLotes.has(d.loteId)) continue;
      seenLotes.add(d.loteId);
      const loteUnits = all.filter((x) => x.loteId === d.loteId);
      const count = (st: string) => loteUnits.filter((x) => x.estado === st).length;
      rows.push({
        ...d,
        loteId: d.loteId,
        loteSize: loteSizes[d.loteId] ?? loteUnits.length,
        loteCount: {
          disponible: count("DISPONIBLE"),
          asignado: count("ASIGNADO"),
          baja: count("BAJA"),
        },
      });
    } else {
      rows.push({ ...d, loteId: null, loteSize: 1 });
    }
  }

  const total = rows.length;
  const data = rows.slice(
    (params.page - 1) * params.limit,
    (params.page - 1) * params.limit + params.limit
  );

  return { data, total };
};

export const getDevice = async (id: string) => {
  const d = await prismaClient.device.findUnique({
    where: { id },
    include: includeFull,
  });
  if (!d) throw new HttpError(404, "Dispositivo no encontrado");
  const loteSizes = d.loteId ? await buildLoteSizes([d.loteId]) : {};
  return {
    ...d,
    loteSize: d.loteId ? loteSizes[d.loteId] ?? 1 : 1,
  };
};

export const getDeviceHistory = async (deviceId: string) => {
  const device = await prismaClient.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new HttpError(404, "Dispositivo no encontrado");

  return prismaClient.deviceHistory.findMany({
    where: { deviceId },
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" },
  });
};

export const addDeviceHistory = async (
  deviceId: string,
  type: string,
  detail?: string,
  autorId?: string
) => {
  return prismaClient.deviceHistory.create({
    data: { deviceId, type, detail: detail ?? null, autorId: autorId ?? null },
  });
};

export const createDevice = async (input: DeviceInput, autorId?: string) => {
  return prismaClient.$transaction(async (tx) => {
    const type = await tx.deviceType.findUnique({
      where: { id: input.typeId },
    });
    if (!type || !type.active) {
      throw new HttpError(400, "Tipo de dispositivo inválido");
    }

    // Validar specs TIC contra el tipo seleccionado
    const ip = normalizeITSpec(type.code, "ip", input.ip);
    const macAddress = normalizeITSpec(type.code, "macAddress", input.macAddress);
    const sistemaOp = normalizeITSpec(type.code, "sistemaOp", input.sistemaOp);
    const ram = normalizeITSpec(type.code, "ram", input.ram);
    const almacenamiento = normalizeITSpec(
      type.code,
      "almacenamiento",
      input.almacenamiento
    );

    const newCounter = type.contador + 1;
    const controlActivos = formatPrefix(type.prefix, newCounter);

    const device = await tx.device.create({
      data: {
        typeId: input.typeId,
        controlActivos,
        descripcion: input.descripcion,
        marca: input.marca,
        modelo: input.modelo,
        numeroSerie: input.numeroSerie ?? null,
        nombreEquipo: input.nombreEquipo ?? null,
        area: input.area ?? "SISTEMAS",
        estado: input.estado ?? "DISPONIBLE",
        ip: ip ?? null,
        macAddress: macAddress ?? null,
        sistemaOp: sistemaOp ?? null,
        ram: ram ?? null,
        almacenamiento: almacenamiento ?? null,
      },
      include: { type: true },
    });

    await tx.deviceType.update({
      where: { id: input.typeId },
      data: { contador: newCounter },
    });

    await tx.deviceHistory.create({
      data: {
        deviceId: device.id,
        type: "CREATED",
        detail: `${device.marca} ${device.modelo} · ${device.controlActivos} · IP ${ip ?? "N/A"} · MAC ${macAddress ?? "N/A"}`,
        autorId: autorId ?? null,
      },
    });

    return device;
  });
};

export const createDevicesBatch = async (
  input: DeviceBatchInput,
  autorId?: string
) => {
  return prismaClient.$transaction(async (tx) => {
    const type = await tx.deviceType.findUnique({ where: { id: input.typeId } });
    if (!type || !type.active) {
      throw new HttpError(400, "Tipo de dispositivo inválido");
    }

    // Specs compartidas (aplican a todas las unidades del lote)
    const sistemaOp = normalizeITSpec(type.code, "sistemaOp", input.sistemaOp);
    const ram = normalizeITSpec(type.code, "ram", input.ram);
    const almacenamiento = normalizeITSpec(
      type.code,
      "almacenamiento",
      input.almacenamiento
    );

    // Validación temprana de duplicados dentro del mismo lote (serie/MAC/IP)
    const seenSeries = new Set<string>();
    const seenMacs = new Set<string>();
    const seenIps = new Set<string>();
    input.units.forEach((u, idx) => {
      if (u.numeroSerie) {
        const key = u.numeroSerie.trim().toUpperCase();
        if (key && seenSeries.has(key)) {
          throw new HttpError(
            400,
            `Número de serie duplicado en el lote (unidad #${idx + 1}): ${u.numeroSerie}`
          );
        }
        if (key) seenSeries.add(key);
      }
      if (u.macAddress) {
        const key = u.macAddress.trim().toUpperCase();
        if (seenMacs.has(key)) {
          throw new HttpError(
            400,
            `MAC Address duplicada en el lote (unidad #${idx + 1}): ${u.macAddress}`
          );
        }
        seenMacs.add(key);
      }
      if (u.ip) {
        const key = u.ip.trim();
        if (seenIps.has(key)) {
          throw new HttpError(
            400,
            `IP duplicada en el lote (unidad #${idx + 1}): ${u.ip}`
          );
        }
        seenIps.add(key);
      }
    });

    const created = [];
    let counter = type.contador;
    // Todas las unidades de esta llamada comparten "lote" para poder editar
    // luego sus datos compartidos (marca, modelo, descripción, specs) juntas.
    const loteId = randomUUID();

    for (let i = 0; i < input.units.length; i++) {
      const unit = input.units[i];
      const ip = normalizeITSpec(type.code, "ip", unit.ip);
      const macAddress = normalizeITSpec(type.code, "macAddress", unit.macAddress);

      counter += 1;
      const controlActivos = formatPrefix(type.prefix, counter);

      const device = await tx.device.create({
        data: {
          typeId: input.typeId,
          controlActivos,
          descripcion: input.descripcion,
          marca: input.marca,
          modelo: input.modelo,
          numeroSerie: unit.numeroSerie ?? null,
          nombreEquipo: unit.nombreEquipo ?? null,
          area: input.area ?? "SISTEMAS",
          estado: input.estado ?? "DISPONIBLE",
          ip: ip ?? null,
          macAddress: macAddress ?? null,
          sistemaOp: sistemaOp ?? null,
          ram: ram ?? null,
          almacenamiento: almacenamiento ?? null,
          loteId,
        },
        include: { type: true },
      });

      await tx.deviceHistory.create({
        data: {
          deviceId: device.id,
          type: "CREATED",
          detail: `Alta por lote (${i + 1}/${input.units.length}) · ${device.marca} ${device.modelo} · ${device.controlActivos} · IP ${ip ?? "N/A"} · MAC ${macAddress ?? "N/A"}`,
          autorId: autorId ?? null,
        },
      });

      created.push(device);
    }

    await tx.deviceType.update({
      where: { id: input.typeId },
      data: { contador: counter },
    });

    return created;
  });
};

// ─── Lotes (agrupan unidades dadas de alta juntas) ──────────────────

export const listDevicesByLote = async (loteId: string) => {
  const devices = await prismaClient.device.findMany({
    where: { loteId },
    include: { type: true },
    orderBy: { controlActivos: "asc" },
  });
  if (devices.length === 0) throw new HttpError(404, "Lote no encontrado");
  return devices;
};

export interface LoteSharedInput {
  descripcion?: string;
  marca?: string;
  modelo?: string;
  sistemaOp?: string;
  ram?: string;
  almacenamiento?: string;
}

export interface LoteUnitInput {
  id: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  ip?: string;
  macAddress?: string;
  // El área es por unidad (cada equipo puede terminar en un departamento
  // distinto), no un dato compartido de todo el lote.
  area?: string;
}

export const updateDevicesLote = async (
  loteId: string,
  shared: LoteSharedInput,
  units: LoteUnitInput[],
  autorId?: string
) => {
  const devices = await prismaClient.device.findMany({
    where: { loteId },
    include: { type: true },
  });
  if (devices.length === 0) throw new HttpError(404, "Lote no encontrado");

  const type = devices[0].type;

  // Specs compartidas (validadas una sola vez contra el tipo del lote)
  const sharedSistemaOp = normalizeITSpec(type.code, "sistemaOp", shared.sistemaOp);
  const sharedRam = normalizeITSpec(type.code, "ram", shared.ram);
  const sharedAlmacenamiento = normalizeITSpec(
    type.code,
    "almacenamiento",
    shared.almacenamiento
  );

  // Duplicados entre las unidades que sí se van a tocar (las ASIGNADO se
  // omiten: sus identificadores quedan protegidos mientras estén prestadas).
  const seenSeries = new Set<string>();
  const seenMacs = new Set<string>();
  const seenIps = new Set<string>();
  for (const u of units) {
    const device = devices.find((d) => d.id === u.id);
    if (!device || device.estado === "ASIGNADO") continue;
    if (u.numeroSerie) {
      const key = u.numeroSerie.trim().toUpperCase();
      if (key) {
        if (seenSeries.has(key)) {
          throw new HttpError(400, `Número de serie duplicado en el lote: ${u.numeroSerie}`);
        }
        seenSeries.add(key);
      }
    }
    if (u.macAddress) {
      const key = u.macAddress.trim().toUpperCase();
      if (seenMacs.has(key)) {
        throw new HttpError(400, `MAC Address duplicada en el lote: ${u.macAddress}`);
      }
      seenMacs.add(key);
    }
    if (u.ip) {
      const key = u.ip.trim();
      if (seenIps.has(key)) {
        throw new HttpError(400, `IP duplicada en el lote: ${u.ip}`);
      }
      seenIps.add(key);
    }
  }

  return prismaClient.$transaction(async (tx) => {
    const results = [];
    for (const device of devices) {
      const unit = units.find((u) => u.id === device.id);
      const isAssigned = device.estado === "ASIGNADO";

      const data: any = {};
      if (shared.descripcion !== undefined) data.descripcion = shared.descripcion;
      if (shared.marca !== undefined) data.marca = shared.marca;
      if (shared.modelo !== undefined) data.modelo = shared.modelo;
      if (shared.sistemaOp !== undefined) data.sistemaOp = sharedSistemaOp ?? null;
      if (shared.ram !== undefined) data.ram = sharedRam ?? null;
      if (shared.almacenamiento !== undefined) data.almacenamiento = sharedAlmacenamiento ?? null;

      if (!isAssigned && unit) {
        if (unit.numeroSerie !== undefined) data.numeroSerie = unit.numeroSerie || null;
        if (unit.nombreEquipo !== undefined) data.nombreEquipo = unit.nombreEquipo || null;
        if (unit.area !== undefined && unit.area) data.area = unit.area;
        if (unit.ip !== undefined) {
          data.ip = normalizeITSpec(type.code, "ip", unit.ip) ?? null;
        }
        if (unit.macAddress !== undefined) {
          data.macAddress = normalizeITSpec(type.code, "macAddress", unit.macAddress) ?? null;
        }
      }

      const updated = await tx.device.update({
        where: { id: device.id },
        data,
        include: { type: true },
      });

      await tx.deviceHistory.create({
        data: {
          deviceId: device.id,
          type: "UPDATED",
          detail: isAssigned
            ? "Edición de lote (solo datos compartidos; unidad prestada — identificadores protegidos)"
            : "Edición de lote",
          autorId: autorId ?? null,
        },
      });

      results.push(updated);
    }
    return results;
  });
};

export const getDevicesSummary = async () => {
  const [total, disponible, asignado, baja, tipos] = await Promise.all([
    prismaClient.device.count(),
    prismaClient.device.count({ where: { estado: "DISPONIBLE" } }),
    prismaClient.device.count({ where: { estado: "ASIGNADO" } }),
    prismaClient.device.count({ where: { estado: "BAJA" } }),
    prismaClient.deviceType.count({ where: { active: true } }),
  ]);
  return { total, disponible, asignado, baja, tipos };
};

export const updateDevice = async (
  id: string,
  data: Partial<DeviceInput>,
  autorId?: string
) => {
  const existing = await prismaClient.device.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Dispositivo no encontrado");

  // Bloqueo: un dispositivo asignado (ASIGNADO) no se puede editar. La única
  // excepción es la propia transición de salida de ese estado (p. ej. al
  // registrar la devolución), que sí debe poder pasar por aquí.
  if (existing.estado === "ASIGNADO") {
    const changingAwayFromAssigned = !!data.estado && data.estado !== "ASIGNADO";
    if (!changingAwayFromAssigned) {
      throw new HttpError(
        409,
        `El dispositivo ${existing.controlActivos} está asignado. Debe registrarse su devolución antes de poder editarlo.`
      );
    }
  }

  // Detectar cambio de estado
  if (data.estado && data.estado !== existing.estado) {
    const statusLabels: Record<string, string> = {
      DISPONIBLE: "Disponible",
      ASIGNADO: "Asignado",
      BAJA: "Baja (retirado)",
    };
    await prismaClient.deviceHistory.create({
      data: {
        deviceId: id,
        type: data.estado === "BAJA" ? "RETIRED" : data.estado === "ASIGNADO" ? "ASSIGNED" : "RETURNED",
        detail: `Estado cambiado a ${statusLabels[data.estado] ?? data.estado}`,
        autorId: autorId ?? null,
      },
    });
  }

  // Si cambia el typeId, se regenera el controlActivos
  if (data.typeId) {
    return prismaClient.$transaction(async (tx) => {
      const newType = await tx.deviceType.findUnique({
        where: { id: data.typeId! },
      });
      if (!newType || !newType.active) {
        throw new HttpError(400, "Tipo de dispositivo inválido");
      }

      // Validar specs TIC contra el nuevo tipo (si vienen en el payload)
      const ip = normalizeITSpec(newType.code, "ip", data.ip);
      const macAddress = normalizeITSpec(
        newType.code,
        "macAddress",
        data.macAddress
      );
      const sistemaOp = normalizeITSpec(
        newType.code,
        "sistemaOp",
        data.sistemaOp
      );
      const ram = normalizeITSpec(newType.code, "ram", data.ram);
      const almacenamiento = normalizeITSpec(
        newType.code,
        "almacenamiento",
        data.almacenamiento
      );

      const newCounter = newType.contador + 1;
      const controlActivos = formatPrefix(newType.prefix, newCounter);

      const device = await tx.device.update({
        where: { id },
        data: {
          ...data,
          controlActivos,
          ip: ip === undefined ? undefined : ip,
          macAddress: macAddress === undefined ? undefined : macAddress,
          sistemaOp: sistemaOp === undefined ? undefined : sistemaOp,
          ram: ram === undefined ? undefined : ram,
          almacenamiento:
            almacenamiento === undefined ? undefined : almacenamiento,
        },
        include: { type: true },
      });

      await tx.deviceType.update({
        where: { id: data.typeId! },
        data: { contador: newCounter },
      });

      await tx.deviceHistory.create({
        data: {
          deviceId: id,
          type: "UPDATED",
          detail: "Tipo de dispositivo cambiado",
          autorId: autorId ?? null,
        },
      });

      return device;
    });
  }

  // Validar specs TIC contra el tipo actual (sin cambio de tipo)
  if (
    data.ip !== undefined ||
    data.macAddress !== undefined ||
    data.sistemaOp !== undefined ||
    data.ram !== undefined ||
    data.almacenamiento !== undefined
  ) {
    const currentType = await prismaClient.deviceType.findUnique({
      where: { id: existing.typeId },
    });
    if (currentType) {
      normalizeITSpec(currentType.code, "ip", data.ip);
      normalizeITSpec(currentType.code, "macAddress", data.macAddress);
      normalizeITSpec(currentType.code, "sistemaOp", data.sistemaOp);
      normalizeITSpec(currentType.code, "ram", data.ram);
      normalizeITSpec(currentType.code, "almacenamiento", data.almacenamiento);
    }
  }

  // Log de campos modificados
  const changedFields: string[] = [];
  const fieldLabels: Record<string, string> = {
    descripcion: "Descripción",
    marca: "Marca",
    modelo: "Modelo",
    numeroSerie: "Número de serie",
    nombreEquipo: "Nombre de equipo",
    area: "Área",
    ip: "IP",
    macAddress: "MAC Address",
    sistemaOp: "Sistema Operativo",
    ram: "RAM",
    almacenamiento: "Almacenamiento",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    const newVal = (data as any)[key];
    if (newVal !== undefined && newVal !== (existing as any)[key]) {
      changedFields.push(`${label}: ${newVal}`);
    }
  }

  if (changedFields.length > 0) {
    await prismaClient.deviceHistory.create({
      data: {
        deviceId: id,
        type: "UPDATED",
        detail: changedFields.join(", "),
        autorId: autorId ?? null,
      },
    });
  }

  return prismaClient.device.update({
    where: { id },
    data,
    include: { type: true },
  });
};

export const deleteDevice = async (id: string, autorId?: string) => {
  const existing = await prismaClient.device.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Dispositivo no encontrado");

  // Bloqueo: un dispositivo asignado (ASIGNADO) no se puede dar de baja ni
  // eliminar. Primero hay que registrar su devolución.
  if (existing.estado === "ASIGNADO") {
    throw new HttpError(
      409,
      `El dispositivo ${existing.controlActivos} está asignado. Registre su devolución antes de dar de baja.`
    );
  }

  // Primera eliminación: soft = dar de baja (estado BAJA). Segunda: físico.
  if (existing.estado !== "BAJA") {
    const device = await prismaClient.$transaction(async (tx) => {
      await tx.deviceHistory.create({
        data: {
          deviceId: id,
          type: "RETIRED",
          detail: "Dispositivo dado de baja",
          autorId: autorId ?? null,
        },
      });
      return tx.device.update({
        where: { id },
        data: { estado: "BAJA" },
      });
    });
    return { soft: true, data: device };
  }

  const data = await prismaClient.device.delete({ where: { id } });
  return { soft: false, data };
};
