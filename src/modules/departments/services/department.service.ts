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
import type { DepartmentCreateInput, DepartmentUpdateInput } from "../models/dto/department.dto";

export class DepartmentService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.department.findMany({
      where: includeInactive ? undefined : { active: true },
      include: {
        subareas: {
          where: { active: true },
          orderBy: { name: "asc" },
        },
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.DepartmentWhereInput = {};

    if (filters.name) where.name = ci(filters.name);
    if (filters.active !== undefined) where.active = Boolean(filters.active);

    const orderBy = orderByOf(
      params.sort,
      {
        name: "name",
        createdAt: "createdAt",
      },
      [{ name: "asc" }]
    );

    const include: Prisma.DepartmentInclude = {
      subareas: {
        where: { active: true },
        orderBy: { name: "asc" },
      },
      _count: { select: { users: true } },
    };

    return paginatedQuery<any>({
      model: this.db.department,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      include: include as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async getById(id: string) {
    const d = await this.db.department.findUnique({
      where: { id },
      include: {
        subareas: { orderBy: { name: "asc" } },
        tickets: {
          where: { deletedAt: null },
          orderBy: { creadoEn: "desc" },
          take: 8,
          include: { asignadoA: { select: { id: true, name: true } } },
        },
        _count: {
          select: {
            users: true,
            tickets: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!d) throw new HttpError(404, "Departamento no encontrado");

    // CartaResponsiva no tiene FK a Department: guarda el nombre en texto
    // libre (mismo criterio que usa el reporte de entregas), así que se
    // resuelve con un match case-insensitive contra el nombre del depto.
    const cartaWhere = { departamento: ci(d.name) };
    const [cartas, cartasTotal] = await Promise.all([
      this.db.cartaResponsiva.findMany({
        where: cartaWhere,
        orderBy: { fecha: "desc" },
        take: 8,
        include: {
          responsable: { select: { id: true, name: true } },
          encargado: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.db.cartaResponsiva.count({ where: cartaWhere }),
    ]);

    return {
      ...d,
      ticketsTotal: d._count.tickets,
      cartas: cartas.map((c) => ({
        id: c.id,
        consecutive: c.consecutive,
        fecha: c.fecha,
        returnDate: c.returnDate,
        responsable: c.responsable,
        encargado: c.encargado,
        itemsCount: c._count.items,
      })),
      cartasTotal,
    };
  }

  async create(data: DepartmentCreateInput) {
    const existing = await this.db.department.findUnique({ where: { name: data.name } });
    if (existing) throw new HttpError(409, "Ya existe un departamento con ese nombre");
    return this.db.department.create({ data: { name: data.name.toUpperCase() } });
  }

  async update(id: string, data: DepartmentUpdateInput) {
    if (data.name) {
      const dup = await this.db.department.findFirst({
        where: { name: data.name.toUpperCase(), NOT: { id } },
      });
      if (dup) throw new HttpError(409, "Nombre duplicado");
    }
    return this.db.department.update({
      where: { id },
      data: {
        ...data,
        ...(data.name ? { name: data.name.toUpperCase() } : {}),
      },
    });
  }

  async remove(id: string) {
    const dept = await this.db.department.findUnique({ where: { id } });
    if (!dept) throw new HttpError(404, "Departamento no encontrado");

    const userCount = await this.db.user.count({
      where: { departmentId: id, active: true },
    });
    if (userCount > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${userCount} usuario(s) asociado(s)`
      );
    }

    // Primera eliminación: soft (active=false). Segunda: físico.
    if (dept.active) {
      const data = await this.db.department.update({
        where: { id },
        data: { active: false },
      });
      return { soft: true, data };
    }

    const data = await this.db.department.delete({ where: { id } });
    return { soft: false, data };
  }
}