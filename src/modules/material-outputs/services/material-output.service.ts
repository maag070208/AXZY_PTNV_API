import type { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { t } from "@core/i18n";
import { broadcastDashboardEvent } from "@core/services/ably";
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
  registeredBy: { select: { id: true, name: true, username: true } },
  deviceUnit: { select: { id: true, assetTag: true } },
};

const DISTINCT_FIELDS = [
  "departmentName",
  "userName",
  "project",
  "brand",
  "model",
  "description",
] as const;

export class MaterialOutputService {
  constructor(private readonly db = prismaClient) {}

  list(filters: MaterialOutputFilters) {
    return this.db.materialOutput.findMany({
      where: this.buildWhere(filters),
      include: includeFull,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where = this.buildWhere({
      start: typeof filters.start === "string" ? filters.start : undefined,
      end: typeof filters.end === "string" ? filters.end : undefined,
      departmentName: typeof filters.departmentName === "string" ? filters.departmentName : undefined,
      userName: typeof filters.userName === "string" ? filters.userName : undefined,
      area: typeof filters.area === "string" ? filters.area : undefined,
      project: typeof filters.project === "string" ? filters.project : undefined,
      reason: typeof filters.reason === "string" ? (filters.reason as any) : undefined,
      q: typeof filters.q === "string" ? filters.q : undefined,
    });

    const orderBy = orderByOf(
      params.sort,
      {
        date: "date",
        description: "description",
        departmentName: "departmentName",
        userName: "userName",
        quantity: "quantity",
        createdAt: "createdAt",
      },
      [{ date: "desc" }, { createdAt: "desc" }]
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
    if (!row) throw new HttpError(404, "MATERIAL_OUTPUT_NOT_FOUND");
    return row;
  }

  async create(input: MaterialOutputInput, authorId?: string) {
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.materialOutput.create({
        data: {
          ...this.normalizeInput(input),
          registeredById: authorId ?? null,
        },
        include: includeFull,
      });
      if (row.deviceUnitId) await this.markDeviceRetirement(tx, row.deviceUnitId, row.id, authorId);
      return row;
    });

    broadcastDashboardEvent({
      scope: "exits",
      message: (lng) => t("activity.materialOutputCreated", { description: row.description }, lng),
      targetId: row.id,
    }).catch(() => {});

    return row;
  }

  async createBatch(rows: MaterialOutputInput[], authorId?: string) {
    const created = await this.db.$transaction(async (tx) => {
      const created = [];
      for (const row of rows) {
        const out = await tx.materialOutput.create({
          data: {
            ...this.normalizeInput(row),
            registeredById: authorId ?? null,
          },
          include: includeFull,
        });
        if (out.deviceUnitId) await this.markDeviceRetirement(tx, out.deviceUnitId, out.id, authorId);
        created.push(out);
      }
      return created;
    });

    broadcastDashboardEvent({
      scope: "exits",
      message: (lng) => t("activity.materialOutputsCreated", { count: created.length }, lng),
      targetId: created[0]?.id,
    }).catch(() => {});

    return created;
  }

  async update(id: string, data: Partial<MaterialOutputInput>, authorId?: string) {
    const existing = await this.db.materialOutput.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "MATERIAL_OUTPUT_NOT_FOUND");

    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.materialOutput.update({
        where: { id },
        data: {
          date: data.date !== undefined ? new Date(data.date) : undefined,
          description: data.description,
          model: data.model !== undefined ? data.model || null : undefined,
          brand: data.brand !== undefined ? data.brand || null : undefined,
          project: data.project !== undefined ? data.project || null : undefined,
          quantity: data.quantity,
          departmentName: data.departmentName,
          userName: data.userName,
          notes: data.notes !== undefined ? data.notes || null : undefined,
          area: data.area,
          reason: data.reason !== undefined ? data.reason || null : undefined,
          deviceUnitId: data.deviceUnitId !== undefined ? data.deviceUnitId || null : undefined,
        },
        include: includeFull,
      });
      if (row.deviceUnitId) await this.markDeviceRetirement(tx, row.deviceUnitId, row.id, authorId);
      return row;
    });

    broadcastDashboardEvent({
      scope: "exits",
      message: (lng) => t("activity.materialOutputUpdated", { description: row.description }, lng),
      targetId: row.id,
    }).catch(() => {});

    return row;
  }

  // El registro de una salida representa que el material/dispositivo ya no
  // sirve y se va a desechar: si viene ligado a una unidad física, esa unidad
  // pasa a BAJA.
  private async markDeviceRetirement(
    tx: Prisma.TransactionClient,
    deviceUnitId: string,
    _exitId: string,
    _authorId?: string
  ) {
    const deviceUnit = await tx.deviceUnit.findUnique({ where: { id: deviceUnitId } });
    if (!deviceUnit || deviceUnit.status === "RETIRED") return;

    await tx.deviceUnit.update({
      where: { id: deviceUnitId },
      data: { status: "RETIRED" },
    });
  }

  async remove(id: string) {
    const existing = await this.db.materialOutput.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "MATERIAL_OUTPUT_NOT_FOUND");
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
      where.date = {};
      if (filters.start) where.date.gte = new Date(filters.start);
      if (filters.end) where.date.lte = new Date(filters.end + "T23:59:59");
    }
    if (filters.departmentName) where.departmentName = ci(filters.departmentName);
    if (filters.userName) where.userName = ci(filters.userName);
    if (filters.area) where.area = ci(filters.area);
    if (filters.project) where.project = ci(filters.project);
    if (filters.reason) where.reason = filters.reason;
    if (filters.q) {
      where.OR = [
        { description: { contains: filters.q, mode: "insensitive" } },
        { model: { contains: filters.q, mode: "insensitive" } },
        { brand: { contains: filters.q, mode: "insensitive" } },
        { project: { contains: filters.q, mode: "insensitive" } },
        { departmentName: { contains: filters.q, mode: "insensitive" } },
        { userName: { contains: filters.q, mode: "insensitive" } },
        { notes: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    return where;
  }

  private normalizeInput(input: MaterialOutputInput) {
    return {
      date: input.date ? new Date(input.date) : new Date(),
      description: input.description,
      model: input.model || null,
      brand: input.brand || null,
      project: input.project || null,
      quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
      departmentName: input.departmentName,
      userName: input.userName,
      notes: input.notes || null,
      area: input.area || "Sistemas",
      reason: input.reason || null,
      deviceUnitId: input.deviceUnitId || null,
    };
  }
}