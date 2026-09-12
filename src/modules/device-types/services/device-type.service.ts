import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedQuery } from "@core/db/table";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { normalizeDeviceFieldConfig } from "../models/fields/device-type.fields";
import type { DeviceFieldConfig } from "../models/fields/device-type.fields";

export const formatPrefix = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

export class DeviceTypeService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.deviceType.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { devices: true } },
      },
    });
  }

  async table(
    params: ITDataTableFetchParams
  ): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Record<string, unknown> = {};

    if (filters.name) where.name = ci(filters.name);
    if (filters.code) where.code = ci(filters.code);
    if (filters.prefix) where.prefix = ci(filters.prefix);
    if (filters.active !== undefined) where.active = Boolean(filters.active);

    const orderBy = orderByOf(
      params.sort,
      {
        name: "name",
        code: "code",
        prefix: "prefix",
        createdAt: "createdAt",
      },
      [{ createdAt: "asc" }]
    );

    return paginatedQuery({
      model: this.db.deviceType,
      where,
      orderBy: orderBy as unknown as never[],
      include: { _count: { select: { devices: true } } } as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async peekNextControlActivo(typeId: string): Promise<string> {
    const type = await this.db.deviceType.findUnique({ where: { id: typeId } });
    if (!type) throw new HttpError(404, "Tipo no encontrado");
    return formatPrefix(type.prefix, type.contador + 1);
  }

  async peekNextCartaFolio(typeId: string): Promise<string> {
    const type = await this.db.deviceType.findUnique({ where: { id: typeId } });
    if (!type) throw new HttpError(404, "Tipo no encontrado");
    return formatPrefix(type.prefix, type.cartaContador + 1);
  }

  async getById(id: string) {
    const t = await this.db.deviceType.findUnique({ where: { id } });
    if (!t) throw new HttpError(404, "Tipo no encontrado");
    return t;
  }

  async create(data: {
    code: string;
    name: string;
    prefix: string;
    fieldConfig?: Partial<DeviceFieldConfig>;
  }) {
    const existing = await this.db.deviceType.findFirst({
      where: {
        OR: [{ code: data.code }, { prefix: data.prefix }],
      },
    });
    if (existing) throw new HttpError(409, "Code o prefix duplicado");

    return this.db.deviceType.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        prefix: data.prefix.toUpperCase(),
        contador: 0,
        fieldConfig: JSON.parse(JSON.stringify(normalizeDeviceFieldConfig(data.fieldConfig, data.code))),
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; prefix?: string; active?: boolean; fieldConfig?: Partial<DeviceFieldConfig> }
  ) {
    const current = await this.db.deviceType.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Tipo no encontrado");
    if (data.prefix) {
      const dup = await this.db.deviceType.findFirst({
        where: { prefix: data.prefix.toUpperCase(), NOT: { id } },
      });
      if (dup) throw new HttpError(409, "Prefix duplicado");
    }
    return this.db.deviceType.update({
      where: { id },
      data: {
        ...data,
        ...(data.prefix ? { prefix: data.prefix.toUpperCase() } : {}),
        ...(data.fieldConfig
          ? { fieldConfig: JSON.parse(JSON.stringify(normalizeDeviceFieldConfig(data.fieldConfig, current.code))) }
          : {}),
      },
    });
  }

  async remove(id: string) {
    const count = await this.db.device.count({ where: { typeId: id } });
    if (count > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${count} dispositivo(s) asociado(s)`
      );
    }
    return this.db.deviceType.update({
      where: { id },
      data: { active: false },
    });
  }
}