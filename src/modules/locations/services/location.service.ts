import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  LocationCreateInput,
  LocationUpdateInput,
} from "../models/dto/location.dto";

export const formatLocation = (loc: {
  lugar?: string | null;
  subLugar?: string | null;
  numero?: string | null;
}): string => {
  const parts = [loc.lugar, loc.subLugar, loc.numero].filter(Boolean);
  return parts.length > 0 ? parts.join("-") : "Sin ubicación";
};

export class LocationService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive?: boolean) {
    return this.db.location.findMany({
      where: includeInactive ? undefined : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { devices: true } },
      },
    });
  }

  async getById(id: string) {
    const loc = await this.db.location.findUnique({
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
  }

  async getBySlug(id: string) {
    return this.db.location.findUnique({
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
  }

  async create(data: LocationCreateInput) {
    return this.db.location.create({
      data: {
        lugar: data.lugar?.toUpperCase() || null,
        subLugar: data.subLugar?.toUpperCase() || null,
        numero: data.numero?.toUpperCase() || null,
        descripcion: data.descripcion || null,
      },
    });
  }

  async update(id: string, data: LocationUpdateInput) {
    const loc = await this.db.location.findUnique({ where: { id } });
    if (!loc) throw new HttpError(404, "Ubicación no encontrada");

    return this.db.location.update({
      where: { id },
      data: {
        lugar: data.lugar !== undefined ? data.lugar?.toUpperCase() || null : loc.lugar,
        subLugar: data.subLugar !== undefined ? data.subLugar?.toUpperCase() || null : loc.subLugar,
        numero: data.numero !== undefined ? data.numero?.toUpperCase() || null : loc.numero,
        descripcion: data.descripcion !== undefined ? data.descripcion || null : loc.descripcion,
      },
    });
  }

  async remove(id: string) {
    const withDevices = await this.db.device.count({ where: { locationId: id } });
    if (withDevices > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${withDevices} dispositivo(s) asignado(s)`
      );
    }
    return this.db.location.delete({ where: { id } });
  }
}