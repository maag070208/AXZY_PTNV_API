import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { formatPrefix } from "../device-types/device-type.service";

export interface DeviceInput {
  typeId: string;
  descripcion: string;
  marca: string;
  modelo: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  area?: string;
  estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
}

const includeFull = {
  type: true,
  history: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
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

  const [total, data] = await prismaClient.$transaction([
    prismaClient.device.count({ where }),
    prismaClient.device.findMany({
      where,
      include: { type: true },
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { data, total };
};

export const getDevice = async (id: string) => {
  const d = await prismaClient.device.findUnique({
    where: { id },
    include: includeFull,
  });
  if (!d) throw new HttpError(404, "Dispositivo no encontrado");
  return d;
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
        area: input.area ?? "MANTENIMIENTO",
        estado: input.estado ?? "DISPONIBLE",
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
        detail: `${device.marca} ${device.modelo} · ${device.controlActivos}`,
        autorId: autorId ?? null,
      },
    });

    return device;
  });
};

export const updateDevice = async (
  id: string,
  data: Partial<DeviceInput>,
  autorId?: string
) => {
  const existing = await prismaClient.device.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Dispositivo no encontrado");

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
      const newCounter = newType.contador + 1;
      const controlActivos = formatPrefix(newType.prefix, newCounter);

      const device = await tx.device.update({
        where: { id },
        data: { ...data, controlActivos },
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

  // Log de campos modificados
  const changedFields: string[] = [];
  const fieldLabels: Record<string, string> = {
    descripcion: "Descripción",
    marca: "Marca",
    modelo: "Modelo",
    numeroSerie: "Número de serie",
    nombreEquipo: "Nombre de equipo",
    area: "Área",
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

  await prismaClient.deviceHistory.create({
    data: {
      deviceId: id,
      type: "RETIRED",
      detail: "Dispositivo dado de baja",
      autorId: autorId ?? null,
    },
  });

  return prismaClient.device.update({
    where: { id },
    data: { estado: "BAJA" },
  });
};
