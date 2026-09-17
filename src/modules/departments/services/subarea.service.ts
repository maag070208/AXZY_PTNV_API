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
import type { SubareaCreateInput, SubareaUpdateInput } from "../models/dto/department.dto";

const departmentRef = { select: { id: true, name: true } } as const;

export class SubareaService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(filters: { departmentId?: string; includeInactive?: boolean } = {}) {
    return this.db.subarea.findMany({
      where: {
        ...(filters.includeInactive ? {} : { active: true }),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      },
      include: { department: departmentRef },
      orderBy: { name: "asc" },
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.SubareaWhereInput = {};

    if (filters.name) where.name = ci(filters.name);
    if (filters.departmentId) where.departmentId = filters.departmentId as string;
    if (filters.active !== undefined) where.active = Boolean(filters.active);

    const orderBy = orderByOf(
      params.sort,
      { name: "name", createdAt: "createdAt" },
      [{ name: "asc" }]
    );

    return paginatedQuery<any>({
      model: this.db.subarea,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      include: { department: departmentRef } as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async getById(id: string) {
    const subarea = await this.db.subarea.findUnique({
      where: { id },
      include: { department: departmentRef },
    });
    if (!subarea) throw new HttpError(404, "Subárea no encontrada");
    return subarea;
  }

  async create(data: SubareaCreateInput) {
    const dep = await this.db.department.findUnique({ where: { id: data.departmentId } });
    if (!dep || !dep.active) throw new HttpError(404, "Departamento inválido");

    const existing = await this.db.subarea.findUnique({
      where: { departmentId_name: { departmentId: data.departmentId, name: data.name } },
    });
    if (existing) throw new HttpError(409, "Ya existe esa subárea");

    return this.db.subarea.create({
      data: { departmentId: data.departmentId, name: data.name },
      include: { department: departmentRef },
    });
  }

  async update(id: string, data: SubareaUpdateInput) {
    const subarea = await this.db.subarea.findUnique({ where: { id } });
    if (!subarea) throw new HttpError(404, "Subárea no encontrada");

    if (data.name) {
      const dup = await this.db.subarea.findUnique({
        where: { departmentId_name: { departmentId: subarea.departmentId, name: data.name } },
      });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe esa subárea");
    }

    return this.db.subarea.update({
      where: { id },
      data,
      include: { department: departmentRef },
    });
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
