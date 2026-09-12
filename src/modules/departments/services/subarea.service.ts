import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { SubareaCreateInput } from "../models/dto/department.dto";

export class SubareaService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async create(departmentId: string, data: SubareaCreateInput) {
    const dep = await this.db.department.findUnique({ where: { id: departmentId } });
    if (!dep || !dep.active) throw new HttpError(404, "Departamento inválido");

    const existing = await this.db.subarea.findUnique({
      where: { departmentId_name: { departmentId, name: data.name } },
    });
    if (existing) throw new HttpError(409, "Ya existe esa subárea");

    return this.db.subarea.create({ data: { departmentId, name: data.name } });
  }

  async remove(id: string) {
    const subarea = await this.db.subarea.findUnique({ where: { id } });
    if (!subarea) throw new HttpError(404, "Subárea no encontrada");

    const userCount = await this.db.user.count({
      where: { subareaId: id, active: true },
    });
    if (userCount > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${userCount} usuario(s) asociado(s)`
      );
    }

    // Primera eliminación: soft (active=false). Segunda: físico.
    if (subarea.active) {
      const data = await this.db.subarea.update({
        where: { id },
        data: { active: false },
      });
      return { soft: true, data };
    }

    const data = await this.db.subarea.delete({ where: { id } });
    return { soft: false, data };
  }
}