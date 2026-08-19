import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

const formatPrefix = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

export const listDeviceTypes = async (includeInactive = false) => {
  return prismaClient.deviceType.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { devices: true } },
    },
  });
};

export const listDeviceTypesTable = async (
  params: ITDataTableFetchParams
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: any = {};

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

  const [total, data] = await prismaClient.$transaction([
    prismaClient.deviceType.count({ where }),
    prismaClient.deviceType.findMany({
      where,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: { _count: { select: { devices: true } } },
    }),
  ]);

  return { data, total };
};

export const peekNextControlActivo = async (typeId: string) => {
  const type = await prismaClient.deviceType.findUnique({
    where: { id: typeId },
  });
  if (!type) throw new HttpError(404, "Tipo no encontrado");
  return formatPrefix(type.prefix, type.contador + 1);
};

export const getDeviceType = async (id: string) => {
  const t = await prismaClient.deviceType.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, "Tipo no encontrado");
  return t;
};

export const createDeviceType = async (data: {
  code: string;
  name: string;
  prefix: string;
}) => {
  const existing = await prismaClient.deviceType.findFirst({
    where: {
      OR: [{ code: data.code }, { prefix: data.prefix }],
    },
  });
  if (existing) throw new HttpError(409, "Code o prefix duplicado");

  return prismaClient.deviceType.create({
    data: {
      code: data.code.toUpperCase(),
      name: data.name,
      prefix: data.prefix.toUpperCase(),
      contador: 0,
    },
  });
};

export const updateDeviceType = async (
  id: string,
  data: { name?: string; prefix?: string; active?: boolean }
) => {
  if (data.prefix) {
    const dup = await prismaClient.deviceType.findFirst({
      where: { prefix: data.prefix.toUpperCase(), NOT: { id } },
    });
    if (dup) throw new HttpError(409, "Prefix duplicado");
  }
  return prismaClient.deviceType.update({
    where: { id },
    data: {
      ...data,
      ...(data.prefix ? { prefix: data.prefix.toUpperCase() } : {}),
    },
  });
};

export const deleteDeviceType = async (id: string) => {
  const count = await prismaClient.device.count({ where: { typeId: id } });
  if (count > 0) {
    throw new HttpError(
      400,
      `No se puede eliminar: tiene ${count} dispositivo(s) asociado(s)`
    );
  }
  return prismaClient.deviceType.update({
    where: { id },
    data: { active: false },
  });
};

export { formatPrefix };