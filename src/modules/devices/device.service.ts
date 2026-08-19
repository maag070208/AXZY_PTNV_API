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
  cantidad?: number;
  marca: string;
  modelo: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  area?: string;
  estado?: "DISPONIBLE" | "ASIGNADO" | "BAJA";
}

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
    include: { type: true },
  });
  if (!d) throw new HttpError(404, "Dispositivo no encontrado");
  return d;
};

export const createDevice = async (input: DeviceInput) => {
  // Transacción: incrementa el contador del tipo y crea el device atómicamente
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
        cantidad: input.cantidad ?? 1,
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

    return device;
  });
};

export const updateDevice = async (
  id: string,
  data: Partial<DeviceInput>
) => {
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
        data: {
          ...data,
          controlActivos,
        },
        include: { type: true },
      });

      await tx.deviceType.update({
        where: { id: data.typeId! },
        data: { contador: newCounter },
      });

      return device;
    });
  }

  return prismaClient.device.update({
    where: { id },
    data,
    include: { type: true },
  });
};

export const deleteDevice = async (id: string) => {
  // Soft-delete via estado BAJA
  return prismaClient.device.update({
    where: { id },
    data: { estado: "BAJA" },
  });
};