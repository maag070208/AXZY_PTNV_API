import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

export const listDepartments = async (includeInactive = false) => {
  return prismaClient.department.findMany({
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
};

export const listDepartmentsTable = async (
  params: ITDataTableFetchParams
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: any = {};

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

  const [total, data] = await prismaClient.$transaction([
    prismaClient.department.count({ where }),
    prismaClient.department.findMany({
      where,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include,
    }),
  ]);

  return { data, total };
};

export const getDepartment = async (id: string) => {
  const d = await prismaClient.department.findUnique({
    where: { id },
    include: {
      subareas: { orderBy: { name: "asc" } },
      _count: { select: { users: true } },
    },
  });
  if (!d) throw new HttpError(404, "Departamento no encontrado");
  return d;
};

export const createDepartment = async (data: { name: string }) => {
  const existing = await prismaClient.department.findUnique({
    where: { name: data.name },
  });
  if (existing) throw new HttpError(409, "Ya existe un departamento con ese nombre");
  return prismaClient.department.create({
    data: { name: data.name.toUpperCase() },
  });
};

export const updateDepartment = async (
  id: string,
  data: { name?: string; active?: boolean }
) => {
  if (data.name) {
    const dup = await prismaClient.department.findFirst({
      where: { name: data.name.toUpperCase(), NOT: { id } },
    });
    if (dup) throw new HttpError(409, "Nombre duplicado");
  }
  return prismaClient.department.update({
    where: { id },
    data: {
      ...data,
      ...(data.name ? { name: data.name.toUpperCase() } : {}),
    },
  });
};

export const deleteDepartment = async (id: string) => {
  const dept = await prismaClient.department.findUnique({ where: { id } });
  if (!dept) throw new HttpError(404, "Departamento no encontrado");

  const userCount = await prismaClient.user.count({
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
    const data = await prismaClient.department.update({
      where: { id },
      data: { active: false },
    });
    return { soft: true, data };
  }

  const data = await prismaClient.department.delete({ where: { id } });
  return { soft: false, data };
};

// === Subareas ===
export const createSubarea = async (
  departmentId: string,
  data: { name: string }
) => {
  const dep = await prismaClient.department.findUnique({
    where: { id: departmentId },
  });
  if (!dep || !dep.active) throw new HttpError(404, "Departamento inválido");

  const existing = await prismaClient.subarea.findUnique({
    where: { departmentId_name: { departmentId, name: data.name } },
  });
  if (existing) throw new HttpError(409, "Ya existe esa subárea");

  return prismaClient.subarea.create({
    data: { departmentId, name: data.name },
  });
};

export const deleteSubarea = async (id: string) => {
  const subarea = await prismaClient.subarea.findUnique({ where: { id } });
  if (!subarea) throw new HttpError(404, "Subárea no encontrada");

  const userCount = await prismaClient.user.count({
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
    const data = await prismaClient.subarea.update({
      where: { id },
      data: { active: false },
    });
    return { soft: true, data };
  }

  const data = await prismaClient.subarea.delete({ where: { id } });
  return { soft: false, data };
};