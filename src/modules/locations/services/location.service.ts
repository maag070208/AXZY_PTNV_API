import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedQuery } from "@core/db/table";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type { LocationCreateInput, LocationUpdateInput } from "../models/dto/location.dto";

export const formatLocation = (loc?: { lugar?: string | null } | null): string =>
  loc?.lugar?.trim() ? loc.lugar.trim() : "Sin ubicación";

const INCLUDE_FULL = {
  sublugares: { orderBy: { name: "asc" } as const },
  _count: { select: { devices: true, cartas: true } },
};

const INCLUDE_ACTIVE = {
  sublugares: { where: { active: true }, orderBy: { name: "asc" } as const },
  _count: { select: { devices: true, cartas: true } },
};

export class LocationService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.location.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { lugar: "asc" },
      include: INCLUDE_ACTIVE,
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.LocationWhereInput = {};

    if (filters.lugar) where.lugar = ci(filters.lugar);
    if (filters.active !== undefined) where.active = Boolean(filters.active);

    const orderBy = orderByOf(
      params.sort,
      { lugar: "lugar", createdAt: "createdAt" },
      [{ lugar: "asc" }]
    );

    return paginatedQuery<any>({
      model: this.db.location,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      include: INCLUDE_ACTIVE as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async getById(id: string) {
    const loc = await this.db.location.findUnique({
      where: { id },
      include: INCLUDE_FULL,
    });
    if (!loc) throw new HttpError(404, "Ubicación no encontrada");
    return loc;
  }

  async create(data: LocationCreateInput) {
    const nombre = data.lugar.trim().toUpperCase();
    const dup = await this.db.location.findFirst({ where: { lugar: nombre } });
    if (dup) throw new HttpError(409, "Ya existe una ubicación con ese lugar");
    return this.db.location.create({
      data: { lugar: nombre, descripcion: data.descripcion || null },
    });
  }

  async update(id: string, data: LocationUpdateInput) {
    const loc = await this.db.location.findUnique({ where: { id } });
    if (!loc) throw new HttpError(404, "Ubicación no encontrada");

    if (data.lugar) {
      const dup = await this.db.location.findFirst({
        where: { lugar: data.lugar.trim().toUpperCase(), NOT: { id } },
      });
      if (dup) throw new HttpError(409, "Ya existe una ubicación con ese lugar");
    }

    return this.db.location.update({
      where: { id },
      data: {
        ...(data.lugar !== undefined ? { lugar: data.lugar.trim().toUpperCase() } : {}),
        ...(data.descripcion !== undefined ? { descripcion: data.descripcion || null } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
  }

  async remove(id: string) {
    const loc = await this.db.location.findUnique({ where: { id } });
    if (!loc) throw new HttpError(404, "Ubicación no encontrada");

    const [withDevices, withCartas, withMovements] = await Promise.all([
      this.db.device.count({ where: { locationId: id } }),
      this.db.cartaResponsiva.count({ where: { ubicacionId: id } }),
      this.db.inventoryMovement.count({ where: { locationId: id } }),
    ]);
    if (withDevices > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${withDevices} dispositivo(s) asignado(s)`
      );
    }
    if (withCartas > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${withCartas} carta(s) responsiva(s) ligada(s)`
      );
    }
    if (withMovements > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${withMovements} movimiento(s) de inventario`
      );
    }

    // Primera eliminación: soft (active=false). Segunda: físico.
    if (loc.active) {
      const data = await this.db.location.update({
        where: { id },
        data: { active: false },
      });
      return { soft: true, data };
    }

    const data = await this.db.location.delete({ where: { id } });
    return { soft: false, data };
  }
}