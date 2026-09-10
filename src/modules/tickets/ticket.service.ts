import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastTicketEvent, broadcastToUser } from "@core/services/ably";
import { sendEmail } from "@core/services/mail";
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
  assignments: {
    include: {
      user: { select: { id: true, name: true, username: true, numeroEmpleado: true, puesto: true } },
      comments: {
        include: { autor: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" as const },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  comments: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { creadoEn: "asc" as const },
  },
  history: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

// ¿El usuario está involucrado en el ticket? (creador, asignado único o
// alguna de las N asignaciones por tarea).
const userInTicket = (
  ticket: { creadoPorId: string; asignadoAId: string | null },
  userId?: string,
  assignments?: Array<{ userId: string }>
): boolean =>
  !!userId &&
  (ticket.creadoPorId === userId ||
    ticket.asignadoAId === userId ||
    !!assignments?.some((a) => a.userId === userId));

const ticketAccessWhere = (userId: string, role: string, departmentId?: string | null): Prisma.TicketWhereInput => {
  if (role === "ADMIN") return {};
  const scopes: Prisma.TicketWhereInput[] = [
    { creadoPorId: userId },
    { asignadoAId: userId },
    { assignments: { some: { userId } } },
  ];
  if (departmentId && (role === "GERENTE" || role === "JEFE_DE_AREA")) scopes.push({ departmentId });
  return { OR: scopes };
};

const assertTicketAccess = (
  ticket: { creadoPorId: string; asignadoAId: string | null; departmentId: string | null; assignments?: Array<{ userId: string }> },
  userId?: string,
  role?: string,
  departmentId?: string | null
) => {
  if (!userId || !role || role === "ADMIN") return;
  const allowed = ticket.creadoPorId === userId || ticket.asignadoAId === userId ||
    !!ticket.assignments?.some((assignment) => assignment.userId === userId) ||
    ((role === "GERENTE" || role === "JEFE_DE_AREA") && !!departmentId && ticket.departmentId === departmentId);
  if (!allowed) throw new HttpError(403, "No autorizado");
};

export const listTickets = async (
  userId: string,
  role: string,
  search?: string,
  departmentId?: string | null
) => {
  const where: Prisma.TicketWhereInput = {
    deletedAt: null,
    ...ticketAccessWhere(userId, role, departmentId),
  };

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
  const where: Prisma.TicketWhereInput = {
    deletedAt: null,
    ...ticketAccessWhere(userId, role, departmentId),
  };

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
  assertTicketAccess(ticket, userId, role, departmentId);
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
  creatorRole?: string;
  creatorDepartmentId?: string | null;
  }) => {
  // Si no se asigna departamento, usar el del creador
  let departmentId = data.creatorRole === "ADMIN"
    ? data.departmentId ?? data.creatorDepartmentId ?? null
    : data.creatorDepartmentId ?? null;
  if (!departmentId) {
    const creator = await prismaClient.user.findUnique({
      where: { id: data.creadoPorId },
      select: { departmentId: true },
    });
    departmentId = creator?.departmentId ?? null;
  }

  if (data.asignadoAId) {
    const responsible = await prismaClient.user.findUnique({
      where: { id: data.asignadoAId },
      select: { active: true },
    });
    if (!responsible?.active) throw new HttpError(400, "Responsable inválido o inactivo");
  }

  const createdTicket = await prismaClient.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        titulo: data.titulo,
        descripcion: data.descripcion,
        priority: (data.priority as any) ?? "MEDIA",
        category: (data.category as any) ?? "OTRO",
        departmentId,
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

    if (departmentId) {
      const dept = await tx.department.findUnique({
        where: { id: departmentId },
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
    category?: string;
    asignadoAId?: string;
    departmentId?: string;
    closedBy?: string;
  },
  userId?: string,
  role?: string,
  departmentId?: string
) => {
  const existing = await prismaClient.ticket.findUnique({ where: { id }, include: { assignments: { select: { userId: true } } } });
  if (!existing) throw new HttpError(404, "Ticket no encontrado");
  assertTicketAccess(existing, userId, role, departmentId);

  // EMPLEADO no puede editar tickets; solo comentar y mover sus tareas.
  if (role === "EMPLEADO") {
    throw new HttpError(403, "Los empleados no pueden editar tickets");
  }
  if (role === "JEFE_DE_AREA" && existing.creadoPorId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  if (data.departmentId !== undefined && role !== "ADMIN") {
    throw new HttpError(403, "Solo ADMIN puede cambiar el departamento del ticket");
  }

  const updateData: Prisma.TicketUpdateInput = {};
  const historyEntries: { type: string; detail: string }[] = [];

  if (data.status === "CERRADO" && role !== "ADMIN" && role !== "GERENTE") {
    throw new HttpError(403, "Solo ADMIN o GERENTE pueden cerrar el ticket");
  }

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

  if (data.category && data.category !== existing.category) {
    const categoryLabels: Record<string, string> = {
      MANTENIMIENTO: "Mantenimiento",
      EQUIPO: "Equipo",
      SISTEMA: "Sistema",
      OTRO: "Otro",
    };
    updateData.category = data.category as any;
    historyEntries.push({
      type: "CATEGORY",
      detail: `Categoría cambiada a ${categoryLabels[data.category] ?? data.category}`,
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
        select: { name: true, active: true },
      });
      if (!assignee?.active) throw new HttpError(400, "Responsable inválido o inactivo");
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
  texto: string,
  role?: string,
  departmentId?: string | null
) => {
  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    include: {
      creadoPor: { select: { name: true, email: true } },
      asignadoA: { select: { name: true, email: true } },
      assignments: { select: { userId: true, user: { select: { email: true } } } },
    },
  });
  if (!ticket) throw new HttpError(404, "Ticket no encontrado");
  assertTicketAccess(ticket, autorId, role, departmentId);

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

  const recipients = [
    ticket.creadoPor.email,
    ticket.asignadoA?.email,
    ...ticket.assignments.map((assignment) => assignment.user.email),
  ].filter((email): email is string => Boolean(email));
  if (recipients.length) {
    sendEmail({
      to: [...new Set(recipients)],
      subject: `Nuevo comentario: ${ticket.titulo}`,
      html: `<p><strong>${autor?.name ?? "Usuario"}</strong> comentó en <strong>${ticket.titulo}</strong>:</p><p>${texto}</p>`,
    }).catch(() => {});
  }

  return comment;
};

export const listKanbanAssignments = async (userId?: string, role?: string, ticketId?: string, departmentId?: string | null) => {
  const where: Prisma.TicketAssignmentWhereInput = {};
  if (ticketId) {
    where.ticketId = ticketId;
  }
  if (role === "EMPLEADO" && userId) {
    where.userId = userId;
  } else if (role === "GERENTE" || role === "JEFE_DE_AREA") {
    where.ticket = {
      OR: [
        ...(userId ? [{ creadoPorId: userId }, { asignadoAId: userId }, { assignments: { some: { userId } } }] : []),
        ...(departmentId ? [{ departmentId }] : []),
      ],
    } as Prisma.TicketWhereInput;
  }
  return prismaClient.ticketAssignment.findMany({
    where,
    include: {
      user: {
        select: { id: true, name: true, username: true, numeroEmpleado: true, puesto: true },
      },
      ticket: {
        select: {
          id: true,
          titulo: true,
          status: true,
          priority: true,
          deletedAt: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
};

export const deleteTicket = async (id: string, userId?: string, role?: string, departmentId?: string) => {
  const existing = await prismaClient.ticket.findUnique({ where: { id }, include: { assignments: { select: { userId: true } } } });
  if (!existing) throw new HttpError(404, "Ticket no encontrado");
  if (role === "EMPLEADO" && !userInTicket(existing, userId, existing.assignments)) {
    throw new HttpError(403, "No autorizado");
  }
  if (role === "JEFE_DE_AREA" && existing.departmentId !== departmentId && existing.creadoPorId !== userId && existing.asignadoAId !== userId) {
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

// ─── Asignaciones (grafo: N empleados, una tarea cada uno) ──────────
const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  EN_REVISION: "En revisión",
  COMPLETADA: "Completada",
};

export const addTicketAssignment = async (
  ticketId: string,
  data: { userId: string; title: string; description: string; startDate?: string | null; dueDate?: string | null },
  actorId?: string,
  actorRole?: string,
  actorDepartmentId?: string | null
) => {
  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    include: { assignments: { select: { userId: true } } },
  });
  if (!ticket) throw new HttpError(404, "Ticket no encontrado");
  assertTicketAccess(ticket, actorId, actorRole, actorDepartmentId);
  const canCreate = actorRole === "ADMIN" || ticket.creadoPorId === actorId || ticket.asignadoAId === actorId;
  if (!canCreate) throw new HttpError(403, "Solo el creador, responsable o ADMIN pueden crear tareas");

  const user = await prismaClient.user.findUnique({
    where: { id: data.userId },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!user || !user.active) throw new HttpError(400, "Empleado inválido");

  const existing = await prismaClient.ticketAssignment.findUnique({
    where: { ticketId_userId: { ticketId, userId: data.userId } },
  });
  if (existing) throw new HttpError(409, "Ese empleado ya tiene una tarea en este ticket");

  return prismaClient.$transaction(async (tx) => {
    const assignment = await tx.ticketAssignment.create({
      data: {
        ticketId,
        userId: data.userId,
        title: data.title.trim(),
        description: data.description.trim(),
        startDate: data.startDate ? new Date(data.startDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      },
      include: {
        user: { select: { id: true, name: true, username: true, numeroEmpleado: true, puesto: true } },
        comments: { include: { autor: { select: { id: true, name: true, username: true } } } },
      },
    });

    // Espejo: la primera asignación también se refleja en asignadoAId (compat
    // con permisos, listados y PDFs que aún usan el asignado único).
    if (!ticket.asignadoAId) {
      await tx.ticket.update({ where: { id: ticketId }, data: { asignadoAId: data.userId } });
    }

    await tx.ticketHistory.create({
      data: {
        ticketId,
        type: "ASSIGNED",
        detail: `Tarea asignada a ${user.name}: ${assignment.title}`,
        autorId: actorId ?? null,
      },
    });

    const actor = actorId
      ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true } })
      : null;
    notifyTicketAssigned(ticketId, ticket.titulo, data.userId, actor?.name ?? "Sistema").catch(() => {});
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: `Nueva tarea: ${assignment.title}`,
        html: `<p>Se te asignó tarea en ticket <strong>${ticket.titulo}</strong>.</p><p>${assignment.title}</p>`,
      }).catch(() => {});
    }

    return assignment;
  });
};

export const updateTicketAssignment = async (
  ticketId: string,
  assignmentId: string,
  data: {
    title?: string;
    description?: string;
    status?: string;
    startDate?: string | null;
    dueDate?: string | null;
  },
  actorId?: string,
  role?: string,
  actorDepartmentId?: string | null
) => {
  const assignment = await prismaClient.ticketAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { name: true } },
      ticket: { select: { status: true, creadoPorId: true, asignadoAId: true, departmentId: true, assignments: { select: { userId: true } } } },
    },
  });
  if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "Asignación no encontrada");
  assertTicketAccess(assignment.ticket, actorId, role, actorDepartmentId);

  const isPrivileged = role === "ADMIN" || role === "GERENTE";
  const isOwner = assignment.userId === actorId;
  const isTicketManager = assignment.ticket.creadoPorId === actorId || assignment.ticket.asignadoAId === actorId;
  if (!isPrivileged && !isOwner && !isTicketManager) {
    throw new HttpError(403, "No autorizado para actualizar esta tarea");
  }
  if (!isPrivileged && isOwner) {
    if (
      data.title !== undefined ||
      data.description !== undefined ||
      data.startDate !== undefined ||
      data.dueDate !== undefined
    ) {
      throw new HttpError(403, "Solo ADMIN o GERENTE pueden editar los datos de la tarea");
    }
  }

  if (data.status === "COMPLETADA" && !isPrivileged) {
    throw new HttpError(403, "Solo ADMIN o GERENTE pueden completar una tarea");
  }

  if (data.status && !isPrivileged && isOwner) {
    const allowedTransitions: Record<string, string[]> = {
      PENDIENTE: ["EN_PROGRESO", "EN_REVISION"],
      EN_PROGRESO: ["EN_REVISION"],
      EN_REVISION: [],
    };
    if (!allowedTransitions[assignment.status]?.includes(data.status)) {
      throw new HttpError(400, "La tarea solo puede avanzar hasta revisión");
    }
  }

  return prismaClient.$transaction(async (tx) => {
    const updated = await tx.ticketAssignment.update({
      where: { id: assignmentId },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate ? new Date(data.startDate) : null } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        ...(data.status !== undefined ? { status: data.status as any } : {}),
      },
      include: {
        user: { select: { id: true, name: true, username: true, numeroEmpleado: true, puesto: true } },
        comments: { include: { autor: { select: { id: true, name: true, username: true } } } },
      },
    });

    const changes: string[] = [];
    if (data.title !== undefined && data.title.trim() !== assignment.title) {
      changes.push(`Título: ${data.title.trim()}`);
    }
    if (data.description !== undefined && data.description.trim() !== assignment.description) {
      changes.push(`Descripción: ${data.description.trim()}`);
    }
    if (data.status !== undefined && data.status !== assignment.status) {
      changes.push(`Estado: ${ASSIGNMENT_STATUS_LABELS[data.status] ?? data.status}`);
    }
    if (changes.length) {
      await tx.ticketHistory.create({
        data: {
          ticketId,
          type: "UPDATED",
          detail: `${assignment.user.name}: ${changes.join(" · ")}`,
          autorId: actorId ?? null,
        },
      });
    }

    broadcastTicketEvent({ type: "UPDATED", ticketId, data: { assignment: updated } }).catch(() => {});
    return updated;
  });
};

export const addAssignmentComment = async (
  ticketId: string,
  assignmentId: string,
  texto: string,
  actorId?: string,
  role?: string,
  departmentId?: string | null
) => {
  const assignment = await prismaClient.ticketAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      ticket: {
        select: {
          id: true,
          titulo: true,
          creadoPorId: true,
          asignadoAId: true,
          departmentId: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "Asignación no encontrada");
  assertTicketAccess(assignment.ticket, actorId, role, departmentId);

  // Permiso: admin/gerente/jefe o el empleado asignado a la tarea.
  if (role === "EMPLEADO" && actorId !== assignment.userId) {
    throw new HttpError(403, "Solo puedes comentar en tus propias tareas");
  }

  const autor = await prismaClient.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });

  const comment = await prismaClient.ticketAssignmentComment.create({
    data: { assignmentId, autorId: actorId ?? "", texto: texto.trim() },
    include: { autor: { select: { id: true, name: true, username: true } } },
  });

  await prismaClient.ticketHistory.create({
    data: {
      ticketId,
      type: "UPDATED",
      detail: `Comentario en tarea ${assignment.title} (${autor?.name ?? "Sistema"})`,
      autorId: actorId ?? null,
    },
  });

  broadcastTicketEvent({ type: "UPDATED", ticketId, data: { assignmentComment: comment } }).catch(() => {});
  return comment;
};

export const removeTicketAssignment = async (
  ticketId: string,
  assignmentId: string,
  actorId?: string
) => {
  const assignment = await prismaClient.ticketAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { name: true } },
      ticket: { select: { asignadoAId: true } },
    },
  });
  if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "Asignación no encontrada");

  return prismaClient.$transaction(async (tx) => {
    await tx.ticketAssignment.delete({ where: { id: assignmentId } });

    // Si el asignado era el espejo asignadoAId, se apunta a otra asignación o
    // se limpia.
    if (assignment.ticket.asignadoAId === assignment.userId) {
      const next = await tx.ticketAssignment.findFirst({ where: { ticketId } });
      await tx.ticket.update({
        where: { id: ticketId },
        data: { asignadoAId: next?.userId ?? null },
      });
    }

    await tx.ticketHistory.create({
      data: {
        ticketId,
        type: "ASSIGNED",
        detail: `Tarea retirada de ${assignment.user.name}`,
        autorId: actorId ?? null,
      },
    });

    broadcastTicketEvent({ type: "UPDATED", ticketId, data: { removedAssignmentId: assignmentId } }).catch(() => {});
    return assignment;
  });
};
