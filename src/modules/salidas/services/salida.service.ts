import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type {
  MaterialOutputFilters,
  MaterialOutputInput,
} from "../models/entity/material-output.entity";

const includeFull = {
  registradoPor: { select: { id: true, name: true, username: true } },
  device: { select: { id: true, controlActivos: true } },
};

const DISTINCT_FIELDS = [
  "departamento",
  "usuario",
  "proyecto",
  "marca",
  "modelo",
  "descripcion",
] as const;

export class SalidaService {
  constructor(private readonly db = prismaClient) {}

  list(filters: MaterialOutputFilters) {
    return this.db.materialOutput.findMany({
      where: this.buildWhere(filters),
      include: includeFull,
      orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where = this.buildWhere({
      start: typeof filters.start === "string" ? filters.start : undefined,
      end: typeof filters.end === "string" ? filters.end : undefined,
      departamento: typeof filters.departamento === "string" ? filters.departamento : undefined,
      usuario: typeof filters.usuario === "string" ? filters.usuario : undefined,
      area: typeof filters.area === "string" ? filters.area : undefined,
      proyecto: typeof filters.proyecto === "string" ? filters.proyecto : undefined,
      q: typeof filters.q === "string" ? filters.q : undefined,
    });

    const orderBy = orderByOf(
      params.sort,
      {
        fecha: "fecha",
        descripcion: "descripcion",
        departamento: "departamento",
        usuario: "usuario",
        cantidad: "cantidad",
        createdAt: "createdAt",
      },
      [{ fecha: "desc" }, { createdAt: "desc" }]
    );

    const [total, data] = await this.db.$transaction([
      this.db.materialOutput.count({ where }),
      this.db.materialOutput.findMany({
        where,
        include: includeFull,
        orderBy: orderBy as any,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    ]);

    return { data, total };
  }

  async getById(id: string) {
    const row = await this.db.materialOutput.findUnique({
      where: { id },
      include: includeFull,
    });
    if (!row) throw new HttpError(404, "Registro de salida no encontrado");
    return row;
  }

  create(input: MaterialOutputInput, autorId?: string) {
    return this.db.materialOutput.create({
      data: {
        ...this.normalizeInput(input),
        registradoPorId: autorId ?? null,
      },
      include: includeFull,
    });
  }

  createBatch(rows: MaterialOutputInput[], autorId?: string) {
    return this.db.$transaction(
      rows.map((row) =>
        this.db.materialOutput.create({
          data: {
            ...this.normalizeInput(row),
            registradoPorId: autorId ?? null,
          },
          include: includeFull,
        })
      )
    );
  }

  async update(id: string, data: Partial<MaterialOutputInput>) {
    const existing = await this.db.materialOutput.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Registro de salida no encontrado");

    return this.db.materialOutput.update({
      where: { id },
      data: {
        fecha: data.fecha !== undefined ? new Date(data.fecha) : undefined,
        descripcion: data.descripcion,
        modelo: data.modelo !== undefined ? data.modelo || null : undefined,
        marca: data.marca !== undefined ? data.marca || null : undefined,
        proyecto: data.proyecto !== undefined ? data.proyecto || null : undefined,
        cantidad: data.cantidad,
        departamento: data.departamento,
        usuario: data.usuario,
        observaciones: data.observaciones !== undefined ? data.observaciones || null : undefined,
        area: data.area,
        deviceId: data.deviceId !== undefined ? data.deviceId || null : undefined,
      },
      include: includeFull,
    });
  }

  async remove(id: string) {
    const existing = await this.db.materialOutput.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Registro de salida no encontrado");
    return this.db.materialOutput.delete({ where: { id } });
  }

  async suggestions() {
    const results = await Promise.all(
      DISTINCT_FIELDS.map(async (field) => {
        // Prisma 5 rechaza `not: null` en `where`, así que se trae el campo
        // distinto crudo y se filtran los vacíos aquí.
        const rows = await this.db.materialOutput.findMany({
          distinct: [field] as any,
          select: { [field]: true } as any,
          take: 50,
        });
        const values = rows
          .map((r: any) => r[field])
          .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "");
        return [field, values] as const;
      })
    );

    return Object.fromEntries(results) as Record<(typeof DISTINCT_FIELDS)[number], string[]>;
  }

  private buildWhere(filters: MaterialOutputFilters) {
    const where: any = {};
    if (filters.start || filters.end) {
      where.fecha = {};
      if (filters.start) where.fecha.gte = new Date(filters.start);
      if (filters.end) where.fecha.lte = new Date(filters.end + "T23:59:59");
    }
    if (filters.departamento) where.departamento = ci(filters.departamento);
    if (filters.usuario) where.usuario = ci(filters.usuario);
    if (filters.area) where.area = ci(filters.area);
    if (filters.proyecto) where.proyecto = ci(filters.proyecto);
    if (filters.q) {
      where.OR = [
        { descripcion: { contains: filters.q, mode: "insensitive" } },
        { modelo: { contains: filters.q, mode: "insensitive" } },
        { marca: { contains: filters.q, mode: "insensitive" } },
        { proyecto: { contains: filters.q, mode: "insensitive" } },
        { departamento: { contains: filters.q, mode: "insensitive" } },
        { usuario: { contains: filters.q, mode: "insensitive" } },
        { observaciones: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    return where;
  }

  private normalizeInput(input: MaterialOutputInput) {
    return {
      fecha: input.fecha ? new Date(input.fecha) : new Date(),
      descripcion: input.descripcion,
      modelo: input.modelo || null,
      marca: input.marca || null,
      proyecto: input.proyecto || null,
      cantidad: input.cantidad && input.cantidad > 0 ? input.cantidad : 1,
      departamento: input.departamento,
      usuario: input.usuario,
      observaciones: input.observaciones || null,
      area: input.area || "Sistemas",
      deviceId: input.deviceId || null,
    };
  }
}