import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

export const listLocations = async (includeInactive = false) => {
  return prismaClient.location.findMany({
    where: includeInactive ? undefined : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { devices: true } },
    },
  });
};

export const getLocation = async (id: string) => {
  const loc = await prismaClient.location.findUnique({
    where: { id },
    include: {
      _count: { select: { devices: true } },
      devices: {
        include: {
          type: true,
        },
      },
    },
  });
  if (!loc) throw new HttpError(404, "Ubicación no encontrada");
  return loc;
};

export const getLocationBySlug = async (id: string) => {
  return prismaClient.location.findUnique({
    where: { id },
    include: {
      devices: {
        include: {
          type: true,
          location: true,
        },
      },
    },
  });
};

export const createLocation = async (data: {
  lugar?: string;
  subLugar?: string;
  numero?: string;
  descripcion?: string;
}) => {
  return prismaClient.location.create({
    data: {
      lugar: data.lugar?.toUpperCase() || null,
      subLugar: data.subLugar?.toUpperCase() || null,
      numero: data.numero?.toUpperCase() || null,
      descripcion: data.descripcion || null,
    },
  });
};

export const updateLocation = async (
  id: string,
  data: {
    lugar?: string;
    subLugar?: string;
    numero?: string;
    descripcion?: string;
  }
) => {
  const loc = await prismaClient.location.findUnique({ where: { id } });
  if (!loc) throw new HttpError(404, "Ubicación no encontrada");

  return prismaClient.location.update({
    where: { id },
    data: {
      lugar: data.lugar !== undefined ? data.lugar?.toUpperCase() || null : loc.lugar,
      subLugar: data.subLugar !== undefined ? data.subLugar?.toUpperCase() || null : loc.subLugar,
      numero: data.numero !== undefined ? data.numero?.toUpperCase() || null : loc.numero,
      descripcion: data.descripcion !== undefined ? data.descripcion || null : loc.descripcion,
    },
  });
};

export const deleteLocation = async (id: string) => {
  const withDevices = await prismaClient.device.count({
    where: { locationId: id },
  });
  if (withDevices > 0) {
    throw new HttpError(
      400,
      `No se puede eliminar: tiene ${withDevices} dispositivo(s) asignado(s)`
    );
  }
  return prismaClient.location.delete({ where: { id } });
};

export const formatLocation = (loc: { lugar?: string | null; subLugar?: string | null; numero?: string | null }): string => {
  const parts = [loc.lugar, loc.subLugar, loc.numero].filter(Boolean);
  return parts.length > 0 ? parts.join("-") : "Sin ubicación";
};
