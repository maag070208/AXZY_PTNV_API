import { Prisma, Role } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

export const listUsers = async (role?: "ADMIN" | "USER" | "EMPLEADO") => {
  return prismaClient.user.findMany({
    where: role ? { role } : undefined,
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      puesto: true,
      numeroEmpleado: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      subareaId: true,
      subarea: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
};

export const listUsersTable = async (
  params: ITDataTableFetchParams,
  callerRole?: string
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: Prisma.UserWhereInput = {};

  // Seguridad: un no-ADMIN solo puede consultar EMPLEADOS
  if (callerRole !== "ADMIN") {
    where.role = "EMPLEADO";
  } else if (filters.role) {
    where.role = String(filters.role) as Role;
  }

  if (filters.active !== undefined) where.active = Boolean(filters.active);
  if (filters.username) where.username = ci(filters.username);
  if (filters.name) where.name = ci(filters.name);
  if (filters.numeroEmpleado) where.numeroEmpleado = ci(filters.numeroEmpleado);
  if (filters.puesto) where.puesto = ci(filters.puesto);
  if (filters.department) where.departmentId = String(filters.department);
  if (filters.subarea) where.subareaId = String(filters.subarea);

  const select = {
    id: true,
    username: true,
    name: true,
    role: true,
    active: true,
    puesto: true,
    numeroEmpleado: true,
    departmentId: true,
    department: { select: { id: true, name: true } },
    subareaId: true,
    subarea: { select: { id: true, name: true } },
    createdAt: true,
  };

  const orderBy = orderByOf(
    params.sort,
    {
      username: "username",
      name: "name",
      role: "role",
      numeroEmpleado: "numeroEmpleado",
      puesto: "puesto",
      createdAt: "createdAt",
    },
    [{ name: "asc" }]
  );

  const [total, data] = await prismaClient.$transaction([
    prismaClient.user.count({ where }),
    prismaClient.user.findMany({
      where,
      select,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { data, total };
};

export const createUser = async (data: {
  username: string;
  password: string;
  name: string;
  role?: "ADMIN" | "USER" | "EMPLEADO";
  puesto?: string;
  numeroEmpleado?: string;
  departmentId?: string;
  subareaId?: string;
}) => {
  const exists = await prismaClient.user.findUnique({
    where: { username: data.username },
  });
  if (exists) throw new HttpError(409, "El username ya existe");

  if (data.numeroEmpleado) {
    const empExists = await prismaClient.user.findUnique({
      where: { numeroEmpleado: data.numeroEmpleado },
    });
    if (empExists) throw new HttpError(409, "Ya existe un usuario con ese número de empleado");
  }

  return prismaClient.user.create({
    data: {
      username: data.username,
      password: await hashPassword(data.password),
      name: data.name,
      role: data.role ?? "EMPLEADO",
      puesto: data.puesto,
      numeroEmpleado: data.numeroEmpleado,
      departmentId: data.departmentId,
      subareaId: data.subareaId,
    },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      puesto: true,
      numeroEmpleado: true,
      departmentId: true,
      subareaId: true,
    },
  });
};

export const updateUser = async (
  id: string,
  data: {
    name?: string;
    role?: "ADMIN" | "USER" | "EMPLEADO";
    active?: boolean;
    puesto?: string;
    numeroEmpleado?: string;
    departmentId?: string | null;
    subareaId?: string | null;
  }
) => {
  if (data.numeroEmpleado) {
    const dup = await prismaClient.user.findFirst({
      where: { numeroEmpleado: data.numeroEmpleado, NOT: { id } },
    });
    if (dup) throw new HttpError(409, "Número de empleado duplicado");
  }
  return prismaClient.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      puesto: true,
      numeroEmpleado: true,
      departmentId: true,
      subareaId: true,
    },
  });
};

export const changePassword = async (id: string, newPassword: string) => {
  return prismaClient.user.update({
    where: { id },
    data: { password: await hashPassword(newPassword) },
    select: { id: true },
  });
};

export const deleteUser = async (id: string) => {
  return prismaClient.user.update({
    where: { id },
    data: { active: false },
    select: { id: true, active: true },
  });
};