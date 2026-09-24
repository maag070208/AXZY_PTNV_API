import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastTicketEvent, broadcastDashboardEvent } from "@core/services/ably";
import { enqueueEmail } from "@core/services/email-queue";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type {
  TicketAssignmentInput,
  TicketAssignmentUpdateInput,
  TicketNotificationPort,
  TicketScope,
} from "../models/entity/ticket.entity";

const includeFull = {
  creadoPor: { select: { id: true, name: true, username: true, puesto: true } },
  asignadoA: { select: { id: true, name: true, username: true, puesto: true } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, nombre: true, activo: true } },
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

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  EN_REVISION: "En revisión",
  COMPLETADA: "Completada",
};

const STATUS_LABELS: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_SEGUIMIENTO: "En seguimiento",
  CERRADO: "Cerrado",
};

const PRIORITY_LABELS: Record<string, string> = {
  BAJA: "Baja",
  MEDIA: "Media",
  ALTA: "Alta",
  URGENTE: "Urgente",
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
  scope: TicketScope
) => {
  const { userId, role, departmentId } = scope;
  if (!userId || !role || role === "ADMIN") return;
  const allowed = ticket.creadoPorId === userId || ticket.asignadoAId === userId ||
    !!ticket.assignments?.some((assignment) => assignment.userId === userId) ||
    ((role === "GERENTE" || role === "JEFE_DE_AREA") && !!departmentId && ticket.departmentId === departmentId);
  if (!allowed) throw new HttpError(403, "No autorizado");
};

export class TicketService {
  constructor(
    private readonly notifications: TicketNotificationPort,
    private readonly db = prismaClient
  ) {}

  async listTickets(userId: string, role: string, search?: string, departmentId?: string | null) {
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
      where.AND = where.AND ? ([where.AND, searchFilter] as Prisma.TicketWhereInput[]) : searchFilter;
    }

    return this.db.ticket.findMany({
      where,
      orderBy: { creadoEn: "desc" },
      include: includeFull,
    });
  }

  async listTicketsTable(
    params: ITDataTableFetchParams,
    userId: string,
    role: string,
    departmentId?: string | null
  ): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
      ...ticketAccessWhere(userId, role, departmentId),
    };

    if (filters.status) where.status = filters.status as any;
    if (filters.priority) where.priority = filters.priority as any;
    if (filters.categoryId) where.categoryId = String(filters.categoryId);
    if (filters.titulo) where.titulo = ci(filters.titulo);

    const orderBy = orderByOf(
      params.sort,
      {
        titulo: "titulo",
        status: "status",
        priority: "priority",
        category: (direction) => ({ category: { nombre: direction } }),
        creadoEn: "creadoEn",
      },
      [{ creadoEn: "desc" }]
    );

    const [total, data] = await this.db.$transaction([
      this.db.ticket.count({ where }),
      this.db.ticket.findMany({
        where,
        orderBy: orderBy as any,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: includeFull,
      }),
    ]);

    return { data, total };
  }

  async getTicketById(id: string, scope: TicketScope = {}) {
    const ticket = await this.db.ticket.findUnique({ where: { id }, include: includeFull });
    if (!ticket) throw new HttpError(404, "Ticket no encontrado");
    assertTicketAccess(ticket, scope);
    return ticket;
  }

  addHistory(ticketId: string, type: string, detail?: string, autorId?: string) {
    return this.db.ticketHistory.create({
      data: { ticketId, type, detail: detail ?? null, autorId: autorId ?? null },
    });
  }

  async createTicket(data: {
    titulo: string;
    descripcion: string;
    priority?: string;
    categoryId?: string;
    departmentId?: string;
    asignadoAId?: string;
    creadoPorId: string;
    creatorRole?: string;
    creatorDepartmentId?: string | null;
  }) {
    // Si no se asigna departamento, usar el del creador
    let departmentId = data.creatorRole === "ADMIN"
      ? data.departmentId ?? data.creatorDepartmentId ?? null
      : data.creatorDepartmentId ?? null;
    if (!departmentId) {
      const creator = await this.db.user.findUnique({
        where: { id: data.creadoPorId },
        select: { departmentId: true },
      });
      departmentId = creator?.departmentId ?? null;
    }

    if (data.asignadoAId) {
      const responsible = await this.db.user.findUnique({
        where: { id: data.asignadoAId },
        select: { active: true },
      });
      if (!responsible?.active) throw new HttpError(400, "Responsable inválido o inactivo");
    }

    const createdTicket = await this.db.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion,
          priority: (data.priority as any) ?? "MEDIA",
          categoryId: data.categoryId ?? null,
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
          detail: `Prioridad ${ticket.priority} · Categoría ${ticket.category?.nombre ?? "—"}`,
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

        const creator = await tx.user.findUnique({
          where: { id: data.creadoPorId },
          select: { name: true },
        });
        this.notifications.notifyTicketAssigned(
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
    broadcastDashboardEvent({
      scope: "tickets",
      message: `Nuevo ticket: ${createdTicket.titulo}`,
      targetId: createdTicket.id,
    }).catch(() => {});

    // Avisar por email a ADMIN/GERENTE (fuera de transacción).
    const admins = await this.db.user.findMany({
      where: { role: { in: ["ADMIN", "GERENTE"] }, active: true, email: { not: null } },
      select: { email: true },
    });
    const recipients = admins.map((admin) => admin.email).filter((email): email is string => Boolean(email));
    if (recipients.length) {
      void enqueueEmail({
        to: recipients,
        subject: `Nuevo ticket: ${createdTicket.titulo}`,
        html: `<p>Se creó ticket <strong>${createdTicket.titulo}</strong>.</p><p>${createdTicket.descripcion}</p>`,
        action: "ticket.created",
        entityType: "Ticket",
        entityId: createdTicket.id,
      });
    }

    return createdTicket;
  }

  async updateTicket(id: string, data: {
    status?: string;
    priority?: string;
    categoryId?: string | null;
    asignadoAId?: string;
    departmentId?: string;
    closedBy?: string;
  }, scope: TicketScope = {}) {
    const { userId, role } = scope;
    const existing = await this.db.ticket.findUnique({
      where: { id },
      include: { assignments: { select: { userId: true } } },
    });
    if (!existing) throw new HttpError(404, "Ticket no encontrado");
    assertTicketAccess(existing, scope);

    // EMPLEADO no puede editar tickets; solo comentar y mover sus tareas.
    if (role === "EMPLEADO") {
      throw new HttpError(403, "Los empleados no pueden editar tickets");
    }
    if (role === "JEFE_DE_AREA" && existing.creadoPorId !== userId && existing.departmentId !== scope.departmentId) {
      throw new HttpError(403, "No autorizado");
    }
    if (data.departmentId !== undefined && role !== "ADMIN") {
      throw new HttpError(403, "Solo ADMIN puede cambiar el departamento del ticket");
    }

    const updateData: Prisma.TicketUpdateInput = {};
    const historyEntries: { type: string; detail: string }[] = [];

    if (data.status === "CERRADO" && !["ADMIN", "GERENTE", "JEFE_DE_AREA"].includes(role ?? "")) {
      throw new HttpError(403, "Solo ADMIN, GERENTE o JEFE_DE_AREA pueden cerrar el ticket");
    }

    if (data.status && data.status !== existing.status) {
      updateData.status = data.status as any;
      historyEntries.push({
        type: "STATUS",
        detail: `Estado cambiado a ${STATUS_LABELS[data.status] ?? data.status}`,
      });
      if (data.status === "CERRADO") {
        updateData.closedAt = new Date();
        updateData.closedBy = data.closedBy ?? null;
        // Al cerrar el ticket, todas sus tareas pendientes pasan a COMPLETADA.
        updateData.assignments = {
          updateMany: {
            where: { status: { not: "COMPLETADA" } },
            data: { status: "COMPLETADA" },
          },
        };
      }
    }

    if (data.priority && data.priority !== existing.priority) {
      updateData.priority = data.priority as any;
      historyEntries.push({
        type: "PRIORITY",
        detail: `Prioridad cambiada a ${PRIORITY_LABELS[data.priority] ?? data.priority}`,
      });
    }

    if (data.categoryId !== undefined && data.categoryId !== existing.categoryId) {
      updateData.category = data.categoryId
        ? { connect: { id: data.categoryId } }
        : { disconnect: true };
      let categoryName = "";
      if (data.categoryId) {
        const cat = await this.db.ticketCategory.findUnique({
          where: { id: data.categoryId },
          select: { nombre: true },
        });
        categoryName = cat?.nombre ?? "";
      }
      historyEntries.push({
        type: "CATEGORY",
        detail: data.categoryId
          ? `Categoría cambiada a ${categoryName}`
          : "Categoría removida",
      });
    }

    if (data.asignadoAId !== undefined && data.asignadoAId !== existing.asignadoAId) {
      updateData.asignadoA = data.asignadoAId
        ? { connect: { id: data.asignadoAId } }
        : { disconnect: true };
      let assigneeName = "";
      if (data.asignadoAId) {
        const assignee = await this.db.user.findUnique({
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
        const dept = await this.db.department.findUnique({
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

    const ticket = await this.db.$transaction(async (tx) => {
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
    if (data.status && data.status !== existing.status) {
      broadcastDashboardEvent({
        scope: "tickets",
        message: `Ticket "${ticket.titulo}" → ${STATUS_LABELS[data.status] ?? data.status}`,
        targetId: ticket.id,
      }).catch(() => {});
    }

    const statusEntry = historyEntries.find((e) => e.type === "STATUS");
    if (statusEntry && userId) {
      const changer = await this.db.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const recipientIds = new Set<string>();
      if (ticket.creadoPorId && ticket.creadoPorId !== userId) recipientIds.add(ticket.creadoPorId);
      if (ticket.asignadoAId && ticket.asignadoAId !== userId) recipientIds.add(ticket.asignadoAId);
      for (const rid of recipientIds) {
        this.notifications.notifyTicketStatusChanged(
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
      const changer = await this.db.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      this.notifications.notifyTicketAssigned(
        id,
        ticket.titulo,
        data.asignadoAId,
        changer?.name ?? "Desconocido"
      ).catch(() => {});
    }

    return ticket;
  }

  async addComment(
    ticketId: string,
    autorId: string,
    texto: string,
    scope: TicketScope = {}
  ) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        creadoPor: { select: { name: true, email: true } },
        asignadoA: { select: { name: true, email: true } },
        assignments: { select: { userId: true, user: { select: { email: true } } } },
      },
    });
    if (!ticket) throw new HttpError(404, "Ticket no encontrado");
    assertTicketAccess(ticket, scope);

    const autor = await this.db.user.findUnique({
      where: { id: autorId },
      select: { name: true },
    });

    const comment = await this.db.ticketComment.create({
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
    this.notifications.notifyTicketComment(
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
      void enqueueEmail({
        to: [...new Set(recipients)],
        subject: `Nuevo comentario: ${ticket.titulo}`,
        html: `<p><strong>${autor?.name ?? "Usuario"}</strong> comentó en <strong>${ticket.titulo}</strong>:</p><p>${texto}</p>`,
        action: "ticket.commented",
        entityType: "Ticket",
        entityId: ticket.id,
      });
    }

    return comment;
  }

  async listKanbanAssignments(scope: TicketScope = {}, ticketId?: string) {
    const { userId, role, departmentId } = scope;
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
    return this.db.ticketAssignment.findMany({
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
            // Para que los clientes sepan qué puede hacer el usuario con la
            // tarea (subir evidencia, moverla) sin pedir el ticket completo.
            creadoPorId: true,
            asignadoAId: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async deleteTicket(id: string, scope: TicketScope = {}) {
    const { userId, role, departmentId } = scope;
    const existing = await this.db.ticket.findUnique({
      where: { id },
      include: { assignments: { select: { userId: true } } },
    });
    if (!existing) throw new HttpError(404, "Ticket no encontrado");
    if (role === "EMPLEADO" && !userInTicket(existing, userId, existing.assignments)) {
      throw new HttpError(403, "No autorizado");
    }
    if (role === "JEFE_DE_AREA" && existing.departmentId !== departmentId && existing.creadoPorId !== userId && existing.asignadoAId !== userId) {
      throw new HttpError(403, "No autorizado");
    }

    // Primera eliminación: soft (papelera). Segunda: físico.
    if (!existing.deletedAt) {
      const ticket = await this.db.ticket.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.db.ticketHistory.create({
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

    const data = await this.db.ticket.delete({ where: { id } });
    broadcastTicketEvent({ type: "DELETED", ticketId: id, data: {} }).catch(() => {});
    return { soft: false, data };
  }

  async addTicketAssignment(
    ticketId: string,
    data: TicketAssignmentInput,
    scope: TicketScope = {}
  ) {
    const { userId: actorId, role: actorRole, departmentId: actorDepartmentId } = scope;
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: { assignments: { select: { userId: true } } },
    });
    if (!ticket) throw new HttpError(404, "Ticket no encontrado");
    assertTicketAccess(ticket, scope);

    // EMPLEADO nunca puede crear/asignar tareas a otros empleados, ni aunque
    // sea el creador o responsable del ticket.
    if (actorRole === "EMPLEADO") {
      throw new HttpError(403, "Los empleados no pueden asignar tareas a otros empleados");
    }
    const canCreate = actorRole === "ADMIN" || ticket.creadoPorId === actorId || ticket.asignadoAId === actorId;
    if (!canCreate) throw new HttpError(403, "Solo el creador, responsable o ADMIN pueden crear tareas");

    const user = await this.db.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true, email: true, active: true, departmentId: true },
    });
    if (!user || !user.active) throw new HttpError(400, "Empleado inválido");

    // JEFE_DE_AREA solo puede asignar tareas a empleados de su propia área.
    if (actorRole === "JEFE_DE_AREA" && actorDepartmentId && user.departmentId !== actorDepartmentId) {
      throw new HttpError(403, "Solo puedes asignar tareas a empleados de tu área");
    }

    const existing = await this.db.ticketAssignment.findUnique({
      where: { ticketId_userId: { ticketId, userId: data.userId } },
    });
    if (existing) throw new HttpError(409, "Ese empleado ya tiene una tarea en este ticket");

    return this.db.$transaction(async (tx) => {
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
      this.notifications.notifyTicketAssigned(ticketId, ticket.titulo, data.userId, actor?.name ?? "Sistema").catch(() => {});
      if (user.email) {
        void enqueueEmail({
          to: user.email,
          subject: `Nueva tarea: ${assignment.title}`,
          html: `<p>Se te asignó tarea en ticket <strong>${ticket.titulo}</strong>.</p><p>${assignment.title}</p>`,
          action: "ticket.assignment",
          entityType: "TicketAssignment",
          entityId: assignment.id,
        });
      }

      return assignment;
    });
  }

  async updateTicketAssignment(
    ticketId: string,
    assignmentId: string,
    data: TicketAssignmentUpdateInput,
    scope: TicketScope = {}
  ) {
    const { userId: actorId, role, departmentId: actorDepartmentId } = scope;
    const assignment = await this.db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        user: { select: { name: true } },
        ticket: { select: { status: true, creadoPorId: true, asignadoAId: true, departmentId: true, assignments: { select: { userId: true } } } },
      },
    });
    if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "Asignación no encontrada");
    assertTicketAccess(assignment.ticket, { userId: actorId, role, departmentId: actorDepartmentId });

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

    return this.db.$transaction(async (tx) => {
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
  }

  async addAssignmentComment(
    ticketId: string,
    assignmentId: string,
    texto: string,
    scope: TicketScope = {}
  ) {
    const { userId: actorId, role } = scope;
    const assignment = await this.db.ticketAssignment.findUnique({
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
    assertTicketAccess(assignment.ticket, scope);

    // Permiso: admin/gerente/jefe o el empleado asignado a la tarea.
    if (role === "EMPLEADO" && actorId !== assignment.userId) {
      throw new HttpError(403, "Solo puedes comentar en tus propias tareas");
    }

    const autor = await this.db.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    const comment = await this.db.ticketAssignmentComment.create({
      data: { assignmentId, autorId: actorId ?? "", texto: texto.trim() },
      include: { autor: { select: { id: true, name: true, username: true } } },
    });

    await this.db.ticketHistory.create({
      data: {
        ticketId,
        type: "UPDATED",
        detail: `Comentario en tarea ${assignment.title} (${autor?.name ?? "Sistema"})`,
        autorId: actorId ?? null,
      },
    });

    broadcastTicketEvent({ type: "UPDATED", ticketId, data: { assignmentComment: comment } }).catch(() => {});
    return comment;
  }

  async removeTicketAssignment(ticketId: string, assignmentId: string, actorId?: string) {
    const assignment = await this.db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        user: { select: { name: true } },
        ticket: { select: { asignadoAId: true } },
      },
    });
    if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "Asignación no encontrada");

    return this.db.$transaction(async (tx) => {
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
  }
}