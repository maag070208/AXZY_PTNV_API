import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { SublugarCreateInput } from "../models/dto/location.dto";

export class SublugarService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async create(locationId: string, data: SublugarCreateInput) {
    const loc = await this.db.location.findUnique({ where: { id: locationId } });
    if (!loc || !loc.active) throw new HttpError(404, "Ubicación inválida");

    const name = data.name.trim().toUpperCase();
    const numero = data.numero ? data.numero.trim().toUpperCase() : null;

    const existing = await this.db.sublugar.findFirst({
      where: { locationId, name, numero },
    });
    if (existing) throw new HttpError(409, "Ya existe esa sub-área");

    return this.db.sublugar.create({ data: { locationId, name, numero } });
  }

  async remove(id: string) {
    const sublugar = await this.db.sublugar.findUnique({ where: { id } });
    if (!sublugar) throw new HttpError(404, "Sub-área no encontrada");

    // Primera eliminación: soft (active=false). Segunda: físico.
    if (sublugar.active) {
      const data = await this.db.sublugar.update({
        where: { id },
        data: { active: false },
      });
      return { soft: true, data };
    }

    const data = await this.db.sublugar.delete({ where: { id } });
    return { soft: false, data };
  }
}