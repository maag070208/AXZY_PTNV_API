import { MaterialOutputReason, type Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { systemLanguage, t } from "@core/i18n";
import { broadcastDashboardEvent } from "@core/services/ably";
import {
  filterDateRange,
  filterEnum,
  filterExact,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
  type TableFilters,
} from "@core/utils/table";
import { parseDateFilter, resolveTimezone } from "@core/utils/timezone";
import type {
  MaterialOutputInput,
} from "../models/entity/material-output.entity";

/** Baja de la unidad ligada a una salida (la implementa inventario). */
export interface UnitRetirementPort {
  retireUnitForMaterialOutput(
    tx: Prisma.TransactionClient,
    deviceUnitId: string,
    authorId: string | undefined,
    reason: string
  ): Promise<unknown>;
}

const includeFull = {
  registeredBy: { select: { id: true, name: true, username: true } },
  deviceUnit: { select: { id: true, assetTag: true, serialNumber: true } },
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
  constructor(
    private readonly inventory: UnitRetirementPort,
    private readonly db = prismaClient
  ) {}

  /** Lista completa con los mismos filtros de la tabla (la usa el PDF). */
  list(filters: TableFilters) {
    return this.db.materialOutput.findMany({
      where: this.buildWhere(filters),
      include: includeFull,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const where = this.buildWhere(params.filters);

    const orderBy = orderByOf(
      params.sort,
      {
        date: "date",
        description: "description",
        departmentName: "departmentName",
        userName: "userName",
        quantity: "quantity",
        q: "description",
        reason: "reason",
        device: (direction: "asc" | "desc") => ({ deviceUnit: { assetTag: direction } }),
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
      if (row.deviceUnitId) await this.retireUnit(tx, row.deviceUnitId, row.description, authorId);
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
        if (out.deviceUnitId) await this.retireUnit(tx, out.deviceUnitId, out.description, authorId);
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
    // La unidad ya se dio de baja con su movimiento: cambiarla dejaría la
    // anterior dada de baja sin salida que la explique.
    const nextUnitId = data.deviceUnitId !== undefined ? data.deviceUnitId || null : existing.deviceUnitId;
    if (existing.deviceUnitId && nextUnitId !== existing.deviceUnitId) {
      throw new HttpError(409, "MATERIAL_OUTPUT_UNIT_LOCKED");
    }

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
      if (row.deviceUnitId && !existing.deviceUnitId) await this.retireUnit(tx, row.deviceUnitId, row.description, authorId);
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
  // pasa a BAJA con su movimiento en el kardex (lo hace inventario).
  private async retireUnit(tx: Prisma.TransactionClient, deviceUnitId: string, description: string, authorId?: string) {
    const reason = t("inventory.materialOutputRetirement", { description }, await systemLanguage());
    await this.inventory.retireUnitForMaterialOutput(tx, deviceUnitId, authorId, reason);
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

  /** Opciones de los filtros Departamento y Usuario: todos los valores registrados. */
  async filterOptions() {
    const distinct = async (field: "departmentName" | "userName") =>
      (
        await this.db.materialOutput.findMany({ distinct: [field], select: { [field]: true }, orderBy: { [field]: "asc" } })
      )
        .map((r) => (r as Record<string, string>)[field])
        .filter((v) => v && v.trim() !== "");
    const [departmentName, userName] = await Promise.all([distinct("departmentName"), distinct("userName")]);
    return { departmentName, userName };
  }

  /**
   * Filtros de la tabla y del PDF (misma semántica). `start`/`end` (YYYY-MM-DD)
   * son el selector de rango de la página: rango `[start, end)` sobre `date`
   * con los límites del día en la zona del reporte y fin EXCLUSIVO.
   */
  private buildWhere(filters: TableFilters): Prisma.MaterialOutputWhereInput {
    const tz = resolveTimezone();
    const start = parseDateFilter(filterId(filters, "start"), tz, "start");
    const end = parseDateFilter(filterId(filters, "end"), tz, "end");
    const q = filterText(filters, "q");
    const device = filterText(filters, "device");
    return {
      ...((start || end) && { date: { ...(start && { gte: start }), ...(end && { lt: end }) } }),
      // Departamento y usuario son texto libre: el filtro elige uno de los
      // valores registrados (`filterOptions`), así que es igualdad.
      departmentName: filterExact(filters, "departmentName"),
      userName: filterExact(filters, "userName"),
      // Columna Fecha (rango); se combina con el selector de la página.
      AND: [{ date: filterDateRange(filters, "date") }],
      area: filterText(filters, "area"),
      project: filterText(filters, "project"),
      reason: filterEnum(filters, "reason", Object.values(MaterialOutputReason)),
      notes: filterText(filters, "notes"),
      ...(device && { deviceUnit: { OR: [{ assetTag: device }, { serialNumber: device }] } }),
      // Descripción (columna) o búsqueda general de la app.
      ...(q && {
        OR: [
          { description: q },
          { model: q },
          { brand: q },
          { project: q },
          { departmentName: q },
          { userName: q },
          { notes: q },
        ],
      }),
    };
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