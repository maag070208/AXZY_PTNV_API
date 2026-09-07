import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastTicketEvent, broadcastToUser } from "@core/services/ably";
import {
  notifyTicketComment,
  notifyTicketAssigned,
  notifyTicketStatusChanged,
} from "@modules/notifications/notification.service";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

const includeFull = {
  creadoPor: { select: { id: true, name: true, username: true, puesto: true } },
  asignadoA: { select: { id: true, name: true, username: true, puesto: true } },
  department: { select: { id: true, name: true } },
  comments: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { creadoEn: "asc" as const },
  },
  history: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

export const listTickets = async (
  userId: string,
  role: string,
  search?: string,
  departmentId?: string | null
) => {
  const where: Prisma.TicketWhereInput = {};

  if (role === "JEFE_DE_AREA" && departmentId) {
    where.departmentId = departmentId;
  } else if (role === "EMPLEADO") {
    where.OR = [
      { creadoPorId: userId },
      { asignadoAId: userId },
    ];
  }

  if (search) {
    const searchFilter: Prisma.TicketWhereInput = {
      OR: [
        { titulo: { contains: search, mode: "insensitive" } },
        { descripcion: { contains: search, mode: "insensitive" } },
      ],
    };
    where.AND = where.AND
      ? ([where.AND, searchFilter] as Prisma.TicketWhereInput[])
      : searchFilter;
  }

  return prismaClient.ticket.findMany({
    where,
    orderBy: { creadoEn: "desc" },
    include: includeFull,
  });
};

export const listTicketsTable = async (
  params: ITDataTableFetchParams,
  userId: string,
  role: string,
  departmentId?: string | null
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: Prisma.TicketWhereInput = {};

  if (role === "JEFE_DE_AREA" && departmentId) {
    where.departmentId = departmentId;
  } else if (role === "EMPLEADO") {
    where.OR = [
      { creadoPorId: userId },
      { asignadoAId: userId },
    ];
  }

  if (filters.status) where.status = filters.status as any;
  if (filters.priority) where.priority = filters.priority as any;
  if (filters.category) where.category = filters.category as any;
  if (filters.titulo) where.titulo = ci(filters.titulo);

  const orderBy = orderByOf(
    params.sort,
    {
      titulo: "titulo",
      status: "status",
      priority: "priority",
      category: "category",
      creadoEn: "creadoEn",
    },
    [{ creadoEn: "desc" }]
  );

  const [total, data] = await prismaClient.$transaction([
    prismaClient.ticket.count({ where }),
    prismaClient.ticket.findMany({
      where,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: includeFull,
    }),
  ]);

  return { data, total };
};

export const getTicketById = async (id: string, userId?: string, role?: string, departmentId?: string) => {
  const ticket = await prismaClient.ticket.findUnique({
    where: { id },
    include: includeFull,
  });
  if (!ticket) throw new HttpError(404, "Ticket no encontrado");
  if (role === "EMPLEADO" && ticket.creadoPorId !== userId && ticket.asignadoAId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  if (role === "JEFE_DE_AREA" && ticket.departmentId !== departmentId) {
    throw new HttpError(403, "No autorizado");
  }
  return ticket;
};

const addHistory = async (
  ticketId: string,
  type: string,
  detail?: string,
  autorId?: string
) => {
  return prismaClient.ticketHistory.create({
    data: { ticketId, type, detail: detail ?? null, autorId: autorId ?? null },
  });
};

export const createTicket = async (data: {
  titulo: string;
  descripcion: string;
  priority?: string;
  category?: string;
  departmentId?: string;
  asignadoAId?: string;
  creadoPorId: string;
  }) => {
  const createdTicket = await prismaClient.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        titulo: data.titulo,
        descripcion: data.descripcion,
        priority: (data.priority as any) ?? "MEDIA",
        category: (data.category as any) ?? "OTRO",
        departmentId: data.departmentId ?? null,
        asignadoAId: data.asignadoAId ?? null,
        creadoPorId: data.creadoPorId,
      },
      include: includeFull,
    });

    await tx.ticketHistory.create({
      data: {
        ticketId: ticket.id,
        type: "CREATED",
        detail: `Prioridad ${ticket.priority} · Categoría ${ticket.category}`,
        autorId: data.creadoPorId,
      },
    });

    if (data.departmentId) {
      const dept = await tx.department.findUnique({
        where: { id: data.departmentId },
        select: { name: true },
      });
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "DEPARTMENT",
          detail: `Departamento asignado: ${dept?.name ?? ""}`,
          autorId: data.creadoPorId,
        },
      });
    }

    if (data.asignadoAId) {
      const assignee = await tx.user.findUnique({
        where: { id: data.asignadoAId },
        select: { name: true },
      });
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "ASSIGNED",
          detail: `Responsable asignado: ${assignee?.name ?? ""}`,
          autorId: data.creadoPorId,
        },
      });

      // Notify assigned user
      const creator = await tx.user.findUnique({
        where: { id: data.creadoPorId },
        select: { name: true },
      });
      notifyTicketAssigned(
        ticket.id,
        ticket.titulo,
        data.asignadoAId,
        creator?.name ?? "Desconocido"
      ).catch(() => {});
    }

    return ticket;
  });

  // Ably broadcast (outside transaction)
  broadcastTicketEvent({
    type: "CREATED",
    ticketId: createdTicket.id,
    data: { ticket: createdTicket },
  }).catch(() => {});

  return createdTicket;
};

export const updateTicket = async (
  id: string,
  data: {
    status?: string;
    priority?: string;
    asignadoAId?: string;
    departmentId?: string;
    closedBy?: string;
  },
  userId?: string,
  role?: string,
  departmentId?: string
) => {
  const existing = await prismaClient.ticket.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Ticket no encontrado");
  if (role === "EMPLEADO" && existing.creadoPorId !== userId && existing.asignadoAId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  if (role === "JEFE_DE_AREA" && existing.departmentId !== departmentId) {
    throw new HttpError(403, "No autorizado");
  }

  const updateData: Prisma.TicketUpdateInput = {};
  const historyEntries: { type: string; detail: string }[] = [];

  if (data.status && data.status !== existing.status) {
    const statusLabels: Record<string, string> = {
      ABIERTO: "Abierto",
      EN_SEGUIMIENTO: "En seguimiento",
      CERRADO: "Cerrado",
    };
    updateData.status = data.status as any;
    historyEntries.push({
      type: "STATUS",
      detail: `Estado cambiado a ${statusLabels[data.status] ?? data.status}`,
    });
    if (data.status === "CERRADO") {
      updateData.closedAt = new Date();
      updateData.closedBy = data.closedBy ?? null;
    }
  }

  if (data.priority && data.priority !== existing.priority) {
    const priorityLabels: Record<string, string> = {
      BAJA: "Baja",
      MEDIA: "Media",
      ALTA: "Alta",
      URGENTE: "Urgente",
    };
    updateData.priority = data.priority as any;
    historyEntries.push({
      type: "PRIORITY",
      detail: `Prioridad cambiada a ${priorityLabels[data.priority] ?? data.priority}`,
    });
  }

  if (data.asignadoAId !== undefined && data.asignadoAId !== existing.asignadoAId) {
    updateData.asignadoA = data.asignadoAId
      ? { connect: { id: data.asignadoAId } }
      : { disconnect: true };
    let assigneeName = "";
    if (data.asignadoAId) {
      const assignee = await prismaClient.user.findUnique({
        where: { id: data.asignadoAId },
        select: { name: true },
      });
      assigneeName = assignee?.name ?? "";
    }
    historyEntries.push({
      type: "ASSIGNED",
      detail: data.asignadoAId
        ? `Responsable asignado: ${assigneeName}`
        : "Responsable removido",
    });
  }

  if (data.departmentId !== undefined && data.departmentId !== existing.departmentId) {
    updateData.department = data.departmentId
      ? { connect: { id: data.departmentId } }
      : { disconnect: true };
    let deptName = "";
    if (data.departmentId) {
      const dept = await prismaClient.department.findUnique({
        where: { id: data.departmentId },
        select: { name: true },
      });
      deptName = dept?.name ?? "";
    }
    historyEntries.push({
      type: "DEPARTMENT",
      detail: data.departmentId
        ? `Departamento asignado: ${deptName}`
        : "Departamento removido",
    });
  }

  const ticket = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id },
      data: updateData,
      include: includeFull,
    });

    for (const entry of historyEntries) {
      await tx.ticketHistory.create({
        data: {
          ticketId: id,
          type: entry.type,
          detail: entry.detail,
          autorId: userId ?? null,
        },
      });
    }

    return updated;
  });

  // Broadcast + notifications (after transaction)
  broadcastTicketEvent({
    type: "UPDATED",
    ticketId: id,
    data: { ticket, changes: historyEntries },
  }).catch(() => {});

  const statusEntry = historyEntries.find((e) => e.type === "STATUS");
  if (statusEntry && userId) {
    const changer = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const recipientIds = new Set<string>();
    if (ticket.creadoPorId && ticket.creadoPorId !== userId) recipientIds.add(ticket.creadoPorId);
    if (ticket.asignadoAId && ticket.asignadoAId !== userId) recipientIds.add(ticket.asignadoAId);
    for (const rid of recipientIds) {
      notifyTicketStatusChanged(
        id,
        ticket.titulo,
        data.status!,
        changer?.name ?? "Desconocido",
        rid
      ).catch(() => {});
    }
  }

  const assignedEntry = historyEntries.find((e) => e.type === "ASSIGNED");
  if (assignedEntry && data.asignadoAId && userId) {
    const changer = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    notifyTicketAssigned(
      id,
      ticket.titulo,
      data.asignadoAId,
      changer?.name ?? "Desconocido"
    ).catch(() => {});
  }

  return ticket;
};

export const addComment = async (
  ticketId: string,
  autorId: string,
  texto: string
) => {
  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    include: { creadoPor: { select: { name: true } }, asignadoA: { select: { name: true } } },
  });
  if (!ticket) throw new HttpError(404, "Ticket no encontrado");

  const autor = await prismaClient.user.findUnique({
    where: { id: autorId },
    select: { name: true },
  });

  const comment = await prismaClient.ticketComment.create({
    data: { ticketId, autorId, texto },
    include: {
      autor: { select: { id: true, name: true, username: true } },
    },
  });

  // Ably: broadcast to ticket channel
  broadcastTicketEvent({
    type: "COMMENT",
    ticketId,
    data: { comment, autorName: autor?.name ?? "Desconocido" },
  }).catch(() => {});

  // DB notification to relevant users
  notifyTicketComment(
    ticketId,
    ticket.titulo,
    autorId,
    autor?.name ?? "Desconocido",
    texto
  ).catch(() => {});

  return comment;
};

export const deleteTicket = async (id: string, userId?: string, role?: string, departmentId?: string) => {
  const existing = await prismaClient.ticket.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Ticket no encontrado");
  if (role === "EMPLEADO" && existing.creadoPorId !== userId && existing.asignadoAId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  if (role === "JEFE_DE_AREA" && existing.departmentId !== departmentId) {
    throw new HttpError(403, "No autorizado");
  }

  // Primera eliminación: soft (papelera). Segunda: físico.
  if (!existing.deletedAt) {
    const ticket = await prismaClient.ticket.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await prismaClient.ticketHistory.create({
      data: {
        ticketId: id,
        type: "DELETED",
        detail: "Ticket movido a papelera",
        autorId: userId ?? null,
      },
    });
    broadcastTicketEvent({ type: "DELETED", ticketId: id, data: {} }).catch(() => {});
    return { soft: true, data: ticket };
  }

  const data = await prismaClient.ticket.delete({ where: { id } });
  broadcastTicketEvent({ type: "DELETED", ticketId: id, data: {} }).catch(() => {});
  return { soft: false, data };
};
