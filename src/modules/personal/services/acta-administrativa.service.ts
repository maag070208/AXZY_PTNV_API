import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { ActaAdministrativaCreateInput } from "../models/dto/acta.dto";
import { actaAdministrativaInclude, type ActaAdministrativaEntity } from "../models/entity/acta.entity";

export class ActaAdministrativaService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async table(params: ITDataTableFetchParams) {
    const { filters = {} } = params;
    const q = String(filters.q ?? "").trim();
    const userId = String(filters.userId ?? "").trim();
    const motivo = String(filters.motivo ?? "").trim();

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (motivo) where.motivo = motivo;

    if (q) {
      const term = `%${q}%`;
      where.OR = [
        { user: { name: { contains: term } } },
        { user: { numeroEmpleado: { contains: term } } },
        { descripcion: { contains: term } },
      ];
    }

    const orderBy = orderByOf(
      params.sort,
      {
        createdAt: "createdAt",
        fechaIncidente: "fechaIncidente",
        motivo: "motivo",
        user: (direction: "asc" | "desc") => ({ user: { name: direction } }),
      },
      [{ createdAt: "desc" }]
    );

    const [data, total] = await this.db.$transaction([
      this.db.cartaAdministrativa.findMany({
        where,
        include: actaAdministrativaInclude,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: orderBy as never[],
      }),
      this.db.cartaAdministrativa.count({ where }),
    ]);

    return { data, total };
  }

  async listByEmployee(userId: string): Promise<ActaAdministrativaEntity[]> {
    const actas = await this.db.cartaAdministrativa.findMany({
      where: { userId },
      include: actaAdministrativaInclude,
      orderBy: { fechaIncidente: "desc" },
    });
    if (!actas.length) {
      const user = await this.db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new HttpError(404, "Empleado no encontrado");
    }
    return actas;
  }

  async getById(id: string): Promise<ActaAdministrativaEntity> {
    const acta = await this.db.cartaAdministrativa.findUnique({
      where: { id },
      include: actaAdministrativaInclude,
    });
    if (!acta) throw new HttpError(404, "Acta administrativa no encontrada");
    return acta;
  }

  async create(input: ActaAdministrativaCreateInput, createdById: string): Promise<ActaAdministrativaEntity> {
    const user = await this.db.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new HttpError(404, "Empleado no encontrado");

    const fechaIncidente = new Date(`${input.fechaIncidente}T12:00:00.000Z`);

    return this.db.cartaAdministrativa.create({
      data: {
        userId: input.userId,
        createdById,
        motivo: input.motivo,
        fechaIncidente,
        descripcion: input.descripcion,
        sancion: input.sancion?.trim() || null,
      },
      include: actaAdministrativaInclude,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const acta = await this.db.cartaAdministrativa.findUnique({ where: { id } });
    if (!acta) throw new HttpError(404, "Acta administrativa no encontrada");
    await this.db.cartaAdministrativa.delete({ where: { id } });
    return { id };
  }
}