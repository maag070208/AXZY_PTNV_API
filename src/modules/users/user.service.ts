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

export const listUsers = async (role?: "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO") => {
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
      empresa: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      subareaId: true,
      subarea: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
};

export const getUserById = async (id: string) => {
  return prismaClient.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      puesto: true,
      numeroEmpleado: true,
      empresa: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      subareaId: true,
      subarea: { select: { id: true, name: true } },
      createdAt: true,
    },
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
    empresa: true,
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
  role?: "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO";
  puesto?: string;
  numeroEmpleado?: string;
  empresa?: string;
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
      empresa: data.empresa,
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
      empresa: true,
      departmentId: true,
      subareaId: true,
    },
  });
};

export const updateUser = async (
  id: string,
  data: {
    name?: string;
    role?: "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO";
    active?: boolean;
    puesto?: string;
    numeroEmpleado?: string;
    empresa?: string;
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
      empresa: true,
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
  const user = await prismaClient.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Usuario no encontrado");

  // Primera eliminación: soft (active=false), igual que departamentos.
  if (user.active) {
    const data = await prismaClient.user.update({
      where: { id },
      data: { active: false },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        active: true,
      },
    });
    return { soft: true, data };
  }

  // Segunda eliminación (usuario ya inactivo): física, solo si no tiene
  // historial ligado (tickets, cartas, comentarios, movimientos, etc.) que
  // rompería la integridad referencial.
  const [
    ticketsCreados,
    ticketsAsignados,
    ticketComments,
    ticketHistory,
    cartasCreadas,
    cartasResponsable,
    cartasEncargado,
    deviceHistory,
    inventoryMovements,
    materialOutputs,
  ] = await prismaClient.$transaction([
    prismaClient.ticket.count({ where: { creadoPorId: id } }),
    prismaClient.ticket.count({ where: { asignadoAId: id } }),
    prismaClient.ticketComment.count({ where: { autorId: id } }),
    prismaClient.ticketHistory.count({ where: { autorId: id } }),
    prismaClient.cartaResponsiva.count({ where: { creadoPorId: id } }),
    prismaClient.cartaResponsiva.count({ where: { responsableId: id } }),
    prismaClient.cartaResponsiva.count({ where: { encargadoId: id } }),
    prismaClient.deviceHistory.count({ where: { autorId: id } }),
    prismaClient.inventoryMovement.count({ where: { userId: id } }),
    prismaClient.materialOutput.count({ where: { registradoPorId: id } }),
  ]);

  const blockers: string[] = [];
  if (ticketsCreados > 0) blockers.push(`${ticketsCreados} ticket(s) creado(s)`);
  if (ticketsAsignados > 0) blockers.push(`${ticketsAsignados} ticket(s) asignado(s)`);
  if (ticketComments > 0) blockers.push(`${ticketComments} comentario(s) de ticket`);
  if (ticketHistory > 0) blockers.push(`${ticketHistory} evento(s) de historial de ticket`);
  if (cartasCreadas > 0) blockers.push(`${cartasCreadas} carta(s) creada(s)`);
  if (cartasResponsable > 0) blockers.push(`${cartasResponsable} carta(s) como responsable`);
  if (cartasEncargado > 0) blockers.push(`${cartasEncargado} carta(s) como encargado`);
  if (deviceHistory > 0) blockers.push(`${deviceHistory} evento(s) de historial de dispositivo`);
  if (inventoryMovements > 0) blockers.push(`${inventoryMovements} movimiento(s) de inventario`);
  if (materialOutputs > 0) blockers.push(`${materialOutputs} salida(s) de material`);

  if (blockers.length > 0) {
    throw new HttpError(
      400,
      `No se puede eliminar definitivamente: tiene ${blockers.join(", ")} en su historial`
    );
  }

  const data = await prismaClient.user.delete({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
    },
  });
  return { soft: false, data };
};

export interface UserHistoryEntry {
  id: string;
  type: "CARTA_CREADA" | "CARTA_RESPONSABLE" | "CARTA_ENCARGADO" | "TICKET_CREADO" | "TICKET_ASIGNADO" | "TICKET_COMENTARIO" | "DISPOSITIVO_HISTORIAL";
  title: string;
  detail: string;
  timestamp: Date;
  refId?: string;
}

export const getUserHistory = async (userId: string): Promise<UserHistoryEntry[]> => {
  const entries: UserHistoryEntry[] = [];

  const [cartasCreadas, cartasResponsable, cartasEncargado, ticketsCreados, ticketsAsignados, ticketComments, deviceHistory] =
    await prismaClient.$transaction([
      prismaClient.cartaResponsiva.findMany({
        where: { creadoPorId: userId },
        select: { id: true, consecutive: true, fecha: true, departamento: true },
        orderBy: { fecha: "desc" },
      }),
      prismaClient.cartaResponsiva.findMany({
        where: { responsableId: userId },
        select: { id: true, consecutive: true, fecha: true, departamento: true },
        orderBy: { fecha: "desc" },
      }),
      prismaClient.cartaResponsiva.findMany({
        where: { encargadoId: userId },
        select: { id: true, consecutive: true, fecha: true, departamento: true },
        orderBy: { fecha: "desc" },
      }),
      prismaClient.ticket.findMany({
        where: { creadoPorId: userId },
        select: { id: true, titulo: true, status: true, creadoEn: true },
        orderBy: { creadoEn: "desc" },
      }),
      prismaClient.ticket.findMany({
        where: { asignadoAId: userId },
        select: { id: true, titulo: true, status: true, creadoEn: true },
        orderBy: { creadoEn: "desc" },
      }),
      prismaClient.ticketComment.findMany({
        where: { autorId: userId },
        select: { id: true, texto: true, creadoEn: true, ticketId: true },
        orderBy: { creadoEn: "desc" },
      }),
      prismaClient.deviceHistory.findMany({
        where: { autorId: userId },
        select: { id: true, type: true, detail: true, createdAt: true, device: { select: { id: true, controlActivos: true, descripcion: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  for (const c of cartasCreadas) {
    entries.push({
      id: `carta-creada-${c.id}`,
      type: "CARTA_CREADA",
      title: "Carta creada",
      detail: `${c.consecutive} — ${c.departamento}`,
      timestamp: c.fecha,
      refId: c.id,
    });
  }

  for (const c of cartasResponsable) {
    entries.push({
      id: `carta-resp-${c.id}`,
      type: "CARTA_RESPONSABLE",
      title: "Responsable de carta",
      detail: `${c.consecutive} — ${c.departamento}`,
      timestamp: c.fecha,
      refId: c.id,
    });
  }

  for (const c of cartasEncargado) {
    entries.push({
      id: `carta-enc-${c.id}`,
      type: "CARTA_ENCARGADO",
      title: "Encargado de carta",
      detail: `${c.consecutive} — ${c.departamento}`,
      timestamp: c.fecha,
      refId: c.id,
    });
  }

  for (const t of ticketsCreados) {
    entries.push({
      id: `ticket-creado-${t.id}`,
      type: "TICKET_CREADO",
      title: "Ticket creado",
      detail: `${t.titulo} — ${t.status}`,
      timestamp: t.creadoEn,
      refId: t.id,
    });
  }

  for (const t of ticketsAsignados) {
    entries.push({
      id: `ticket-asig-${t.id}`,
      type: "TICKET_ASIGNADO",
      title: "Ticket asignado",
      detail: `${t.titulo} — ${t.status}`,
      timestamp: t.creadoEn,
      refId: t.id,
    });
  }

  for (const c of ticketComments) {
    entries.push({
      id: `comment-${c.id}`,
      type: "TICKET_COMENTARIO",
      title: "Comentario en ticket",
      detail: `Ticket ${c.ticketId}: "${c.texto}"`,
      timestamp: c.creadoEn,
      refId: c.ticketId,
    });
  }

  for (const h of deviceHistory) {
    const typeLabels: Record<string, string> = {
      CREATED: "Dispositivo registrado",
      ASSIGNED: "Dispositivo asignado",
      RETURNED: "Dispositivo devuelto",
      RETIRED: "Dispositivo retirado",
      UPDATED: "Dispositivo actualizado",
      COMMENT: "Comentario en dispositivo",
    };
    entries.push({
      id: `devhist-${h.id}`,
      type: "DISPOSITIVO_HISTORIAL",
      title: typeLabels[h.type] ?? h.type,
      detail: `${h.device.controlActivos} — ${h.device.descripcion}${h.detail ? `: ${h.detail}` : ""}`,
      timestamp: h.createdAt,
      refId: h.device.id,
    });
  }

  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return entries;
};