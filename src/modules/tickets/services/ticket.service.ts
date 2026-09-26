import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastTicketEvent, broadcastDashboardEvent } from "@core/services/ably";
import { enqueueEmail } from "@core/services/email-queue";
import {
  scopeOf,
  withinScope,
  canViewTicket,
  visibleTasks,
  visibleTickets,
  type UserPermissions,
} from "@core/permissions";
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
} from "../models/entity/ticket.entity";

const includeFull = {
  createdBy: { select: { id: true, name: true, username: true, jobTitle: true } },
  assignedTo: { select: { id: true, name: true, username: true, jobTitle: true } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, active: true } },
  assignments: {
    include: {
      user: { select: { id: true, name: true, username: true, employeeNumber: true, jobTitle: true } },
      comments: {
        include: { author: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" as const },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  comments: {
    include: { author: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  history: {
    include: { author: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En progreso",
  IN_REVIEW: "En revisión",
  COMPLETED: "Completada",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierto",
  IN_PROGRESS: "En seguimiento",
  CLOSED: "Cerrado",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export class TicketService {
  constructor(
    private readonly notifications: TicketNotificationPort,
    private readonly db = prismaClient
  ) {}

  async listTickets(user: UserPermissions, search?: string) {
    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
      ...visibleTickets(user),
    };

    if (search) {
      const searchFilter: Prisma.TicketWhereInput = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      };
      where.AND = where.AND ? ([where.AND, searchFilter] as Prisma.TicketWhereInput[]) : searchFilter;
    }

    return this.db.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: includeFull,
    });
  }

  async listTicketsTable(
    params: ITDataTableFetchParams,
    user: UserPermissions
  ): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
      ...visibleTickets(user),
    };

    if (filters.status) where.status = filters.status as any;
    if (filters.priority) where.priority = filters.priority as any;
    if (filters.categoryId) where.categoryId = String(filters.categoryId);
    if (filters.title) where.title = ci(filters.title);

    const orderBy = orderByOf(
      params.sort,
      {
        title: "title",
        status: "status",
        priority: "priority",
        category: (direction) => ({ category: { name: direction } }),
        createdAt: "createdAt",
      },
      [{ createdAt: "desc" }]
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

  async getTicketById(id: string, user: UserPermissions) {
    const ticket = await this.db.ticket.findUnique({ where: { id }, include: includeFull });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND");
    if (!canViewTicket(user, ticket)) throw new HttpError(403, "FORBIDDEN");
    return ticket;
  }

  addHistory(ticketId: string, type: string, detail?: string, authorId?: string) {
    return this.db.ticketHistory.create({
      data: { ticketId, type, detail: detail ?? null, authorId: authorId ?? null },
    });
  }

  async createTicket(data: {
    title: string;
    description: string;
    priority?: string;
    categoryId?: string;
    departmentId?: string;
    assignedToId?: string;
    createdById: string;
    creatorRole?: string;
    creatorDepartmentId?: string | null;
  }) {
    // Si no se asigna departamento, usar el del creador
    let departmentId = data.creatorRole === "ADMIN"
      ? data.departmentId ?? data.creatorDepartmentId ?? null
      : data.creatorDepartmentId ?? null;
    if (!departmentId) {
      const creator = await this.db.user.findUnique({
        where: { id: data.createdById },
        select: { departmentId: true },
      });
      departmentId = creator?.departmentId ?? null;
    }

    if (data.assignedToId) {
      const responsible = await this.db.user.findUnique({
        where: { id: data.assignedToId },
        select: { active: true },
      });
      if (!responsible?.active) throw new HttpError(400, "INVALID_ASSIGNEE");
    }

    const createdTicket = await this.db.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          title: data.title,
          description: data.description,
          priority: (data.priority as any) ?? "MEDIUM",
          categoryId: data.categoryId ?? null,
          departmentId,
          assignedToId: data.assignedToId ?? null,
          createdById: data.createdById,
        },
        include: includeFull,
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "CREATED",
          detail: `Prioridad ${ticket.priority} · Categoría ${ticket.category?.name ?? "—"}`,
          authorId: data.createdById,
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
            authorId: data.createdById,
          },
        });
      }

      if (data.assignedToId) {
        const assignee = await tx.user.findUnique({
          where: { id: data.assignedToId },
          select: { name: true },
        });
        await tx.ticketHistory.create({
          data: {
            ticketId: ticket.id,
            type: "ASSIGNED",
            detail: `Responsable asignado: ${assignee?.name ?? ""}`,
            authorId: data.createdById,
          },
        });

        const creator = await tx.user.findUnique({
          where: { id: data.createdById },
          select: { name: true },
        });
        this.notifications.notifyTicketAssigned(
          ticket.id,
          ticket.title,
          data.assignedToId,
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
      message: `Nuevo ticket: ${createdTicket.title}`,
      targetId: createdTicket.id,
    }).catch(() => {});

    // Avisar por email a ADMIN/GERENTE (fuera de transacción).
    const admins = await this.db.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER"] }, active: true, email: { not: null } },
      select: { email: true },
    });
    const recipients = admins.map((admin) => admin.email).filter((email): email is string => Boolean(email));
    if (recipients.length) {
      void enqueueEmail({
        to: recipients,
        subject: `Nuevo ticket: ${createdTicket.title}`,
        html: `<p>Se creó ticket <strong>${createdTicket.title}</strong>.</p><p>${createdTicket.description}</p>`,
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
    assignedToId?: string;
    departmentId?: string;
    closedBy?: string;
  }, user: UserPermissions) {
    const existing = await this.db.ticket.findUnique({
      where: { id },
      include: { assignments: { select: { userId: true } } },
    });
    if (!existing) throw new HttpError(404, "TICKET_NOT_FOUND");
    if (!canViewTicket(user, existing)) throw new HttpError(403, "FORBIDDEN");

    // Editar exige `tickets.editar` sobre el ticket. Sin el permiso no se
    // edita: el EMPLEADO (y RH/GUARDIA) solo comenta y mueve sus tareas.
    const scopeEdit = scopeOf(user, "tickets.edit");
    if (scopeEdit === "NONE") {
      throw new HttpError(403, "EMPLOYEES_CANNOT_EDIT_TICKETS");
    }
    if (!withinScope(user, scopeEdit, existing)) {
      throw new HttpError(403, "FORBIDDEN");
    }
    // Regla fija §4.5: solo `tickets.editar` con alcance TODO cambia el
    // departamento del ticket.
    if (data.departmentId !== undefined && scopeEdit !== "ALL") {
      throw new HttpError(403, "ONLY_ADMIN_CHANGES_TICKET_DEPARTMENT");
    }

    const updateData: Prisma.TicketUpdateInput = {};
    const historyEntries: { type: string; detail: string }[] = [];

    // Regla fija §4: cerrar exige `tickets.cerrar` sobre el ticket.
    if (data.status === "CLOSED" && !withinScope(user, scopeOf(user, "tickets.close"), existing)) {
      throw new HttpError(403, "ONLY_MANAGERS_CLOSE_TICKETS");
    }

    if (data.status && data.status !== existing.status) {
      updateData.status = data.status as any;
      historyEntries.push({
        type: "STATUS",
        detail: `Estado cambiado a ${STATUS_LABELS[data.status] ?? data.status}`,
      });
      if (data.status === "CLOSED") {
        updateData.closedAt = new Date();
        updateData.closedBy = data.closedBy ?? null;
        // Al cerrar el ticket, todas sus tareas pendientes pasan a COMPLETADA.
        updateData.assignments = {
          updateMany: {
            where: { status: { not: "COMPLETED" } },
            data: { status: "COMPLETED" },
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
          select: { name: true },
        });
        categoryName = cat?.name ?? "";
      }
      historyEntries.push({
        type: "CATEGORY",
        detail: data.categoryId
          ? `Categoría cambiada a ${categoryName}`
          : "Categoría removida",
      });
    }

    if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
      updateData.assignedTo = data.assignedToId
        ? { connect: { id: data.assignedToId } }
        : { disconnect: true };
      let assigneeName = "";
      if (data.assignedToId) {
        const assignee = await this.db.user.findUnique({
          where: { id: data.assignedToId },
          select: { name: true, active: true },
        });
        if (!assignee?.active) throw new HttpError(400, "INVALID_ASSIGNEE");
        assigneeName = assignee?.name ?? "";
      }
      historyEntries.push({
        type: "ASSIGNED",
        detail: data.assignedToId
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
            authorId: user.id,
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
        message: `Ticket "${ticket.title}" → ${STATUS_LABELS[data.status] ?? data.status}`,
        targetId: ticket.id,
      }).catch(() => {});
    }

    const statusEntry = historyEntries.find((e) => e.type === "STATUS");
    if (statusEntry) {
      const changer = await this.db.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      });
      const recipientIds = new Set<string>();
      if (ticket.createdById && ticket.createdById !== user.id) recipientIds.add(ticket.createdById);
      if (ticket.assignedToId && ticket.assignedToId !== user.id) recipientIds.add(ticket.assignedToId);
      for (const rid of recipientIds) {
        this.notifications.notifyTicketStatusChanged(
          id,
          ticket.title,
          data.status!,
          changer?.name ?? "Desconocido",
          rid
        ).catch(() => {});
      }
    }

    const assignedEntry = historyEntries.find((e) => e.type === "ASSIGNED");
    if (assignedEntry && data.assignedToId) {
      const changer = await this.db.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      });
      this.notifications.notifyTicketAssigned(
        id,
        ticket.title,
        data.assignedToId,
        changer?.name ?? "Desconocido"
      ).catch(() => {});
    }

    return ticket;
  }

  async addComment(
    ticketId: string,
    authorId: string,
    text: string,
    user: UserPermissions
  ) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: { select: { name: true, email: true } },
        assignedTo: { select: { name: true, email: true } },
        assignments: { select: { userId: true, user: { select: { email: true } } } },
      },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND");
    if (!canViewTicket(user, ticket)) throw new HttpError(403, "FORBIDDEN");

    const author = await this.db.user.findUnique({
      where: { id: authorId },
      select: { name: true },
    });

    const comment = await this.db.ticketComment.create({
      data: { ticketId, authorId, text },
      include: {
        author: { select: { id: true, name: true, username: true } },
      },
    });

    // Ably: broadcast to ticket channel
    broadcastTicketEvent({
      type: "COMMENT",
      ticketId,
      data: { comment, authorName: author?.name ?? "Desconocido" },
    }).catch(() => {});

    // DB notification to relevant users
    this.notifications.notifyTicketComment(
      ticketId,
      ticket.title,
      authorId,
      author?.name ?? "Desconocido",
      text
    ).catch(() => {});

    const recipients = [
      ticket.createdBy.email,
      ticket.assignedTo?.email,
      ...ticket.assignments.map((assignment) => assignment.user.email),
    ].filter((email): email is string => Boolean(email));
    if (recipients.length) {
      void enqueueEmail({
        to: [...new Set(recipients)],
        subject: `Nuevo comentario: ${ticket.title}`,
        html: `<p><strong>${author?.name ?? "Usuario"}</strong> comentó en <strong>${ticket.title}</strong>:</p><p>${text}</p>`,
        action: "ticket.commented",
        entityType: "Ticket",
        entityId: ticket.id,
      });
    }

    return comment;
  }

  async listKanbanAssignments(user: UserPermissions, ticketId?: string) {
    const where: Prisma.TicketAssignmentWhereInput = {};
    if (ticketId) {
      where.ticketId = ticketId;
    }
    const scopeTasks = scopeOf(user, "tasks.view");
    if (scopeTasks === "NONE") return [];
    if (scopeTasks !== "ALL") {
      // Regla del tablero (fix 2026-09-25): el EMPLEADO solo ve sus propias
      // tareas. El resto (GERENTE, JEFE, RH, GUARDIA…): las de los tickets que
      // ve en la lista; nunca todo el tablero.
      if (user.role === "EMPLOYEE") where.userId = user.id;
      else where.ticket = visibleTasks(user);
    }
    return this.db.ticketAssignment.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, username: true, employeeNumber: true, jobTitle: true },
        },
        ticket: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            deletedAt: true,
            // Para que los clientes sepan qué puede hacer el usuario con la
            // tarea (subir evidencia, moverla) sin pedir el ticket completo.
            createdById: true,
            assignedToId: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async deleteTicket(id: string, user: UserPermissions) {
    const existing = await this.db.ticket.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "TICKET_NOT_FOUND");
    // Regla fija §4: borrar exige `tickets.eliminar` sobre el ticket.
    if (!withinScope(user, scopeOf(user, "tickets.delete"), existing)) {
      throw new HttpError(403, "FORBIDDEN");
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
          authorId: user.id,
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
    requester: UserPermissions
  ) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: { assignments: { select: { userId: true } } },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND");
    if (!canViewTicket(requester, ticket)) throw new HttpError(403, "FORBIDDEN");

    // Asignar exige `tareas.asignar` sobre el ticket. El EMPLEADO nunca puede
    // crear tareas a otros empleados, ni aunque sea creador o responsable.
    const scopeAssign = scopeOf(requester, "tasks.assign");
    if (scopeAssign === "NONE") {
      throw new HttpError(403, "EMPLOYEES_CANNOT_ASSIGN_TASKS");
    }
    if (!withinScope(requester, scopeAssign, ticket)) {
      throw new HttpError(403, "ONLY_OWNERS_CREATE_TASKS");
    }

    const user = await this.db.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true, email: true, active: true, departmentId: true },
    });
    if (!user || !user.active) throw new HttpError(400, "INVALID_EMPLOYEE");

    // Regla fija §4.2: el JEFE DE ÁREA solo asigna tareas a personas de su área.
    if (requester.role === "AREA_HEAD" && requester.departmentId && user.departmentId !== requester.departmentId) {
      throw new HttpError(403, "ASSIGN_ONLY_OWN_AREA");
    }

    const existing = await this.db.ticketAssignment.findUnique({
      where: { ticketId_userId: { ticketId, userId: data.userId } },
    });
    if (existing) throw new HttpError(409, "EMPLOYEE_ALREADY_HAS_TASK");

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
          user: { select: { id: true, name: true, username: true, employeeNumber: true, jobTitle: true } },
          comments: { include: { author: { select: { id: true, name: true, username: true } } } },
        },
      });

      // Espejo: la primera asignación también se refleja en asignadoAId (compat
      // con permisos, listados y PDFs que aún usan el asignado único).
      if (!ticket.assignedToId) {
        await tx.ticket.update({ where: { id: ticketId }, data: { assignedToId: data.userId } });
      }

      await tx.ticketHistory.create({
        data: {
          ticketId,
          type: "ASSIGNED",
          detail: `Tarea asignada a ${user.name}: ${assignment.title}`,
          authorId: requester.id,
        },
      });

      const actor = await tx.user.findUnique({ where: { id: requester.id }, select: { name: true } });
      this.notifications.notifyTicketAssigned(ticketId, ticket.title, data.userId, actor?.name ?? "Sistema").catch(() => {});
      if (user.email) {
        void enqueueEmail({
          to: user.email,
          subject: `Nueva tarea: ${assignment.title}`,
          html: `<p>Se te asignó tarea en ticket <strong>${ticket.title}</strong>.</p><p>${assignment.title}</p>`,
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
    user: UserPermissions
  ) {
    const assignment = await this.db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        user: { select: { name: true } },
        ticket: { select: { status: true, createdById: true, assignedToId: true, departmentId: true, assignments: { select: { userId: true } } } },
      },
    });
    if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "ASSIGNMENT_NOT_FOUND");
    const ticket = assignment.ticket;
    if (!canViewTicket(user, ticket)) throw new HttpError(403, "FORBIDDEN");

    const canManageTask = withinScope(user, scopeOf(user, "tasks.assign"), ticket);
    const canCompleteTask = withinScope(user, scopeOf(user, "tasks.complete"), ticket);
    const isOwner = assignment.userId === user.id;
    // Regla fija §4.1: quien tiene la tarea la avanza.
    if (!canManageTask && !isOwner) {
      throw new HttpError(403, "FORBIDDEN_TASK_UPDATE");
    }
    const canEditTaskData = canManageTask || canCompleteTask;
    if (!canEditTaskData) {
      if (
        data.title !== undefined ||
        data.description !== undefined ||
        data.startDate !== undefined ||
        data.dueDate !== undefined
      ) {
        throw new HttpError(403, "ONLY_MANAGERS_EDIT_TASKS");
      }
    }

    if (data.status === "COMPLETED" && !canCompleteTask) {
      throw new HttpError(403, "ONLY_MANAGERS_COMPLETE_TASKS");
    }

    if (data.status && !canCompleteTask && isOwner) {
      const allowedTransitions: Record<string, string[]> = {
        PENDING: ["IN_PROGRESS", "IN_REVIEW"],
        IN_PROGRESS: ["IN_REVIEW"],
        IN_REVIEW: [],
      };
      if (!allowedTransitions[assignment.status]?.includes(data.status)) {
        throw new HttpError(400, "TASK_MAX_IN_REVIEW");
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
          user: { select: { id: true, name: true, username: true, employeeNumber: true, jobTitle: true } },
          comments: { include: { author: { select: { id: true, name: true, username: true } } } },
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
            authorId: user.id,
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
    text: string,
    user: UserPermissions
  ) {
    const assignment = await this.db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        ticket: {
          select: {
            id: true,
            title: true,
            createdById: true,
            assignedToId: true,
            departmentId: true,
            assignments: { select: { userId: true } },
          },
        },
      },
    });
    if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "ASSIGNMENT_NOT_FOUND");
    if (!canViewTicket(user, assignment.ticket)) throw new HttpError(403, "FORBIDDEN");

    // Ver tareas con alcance propio (EMPLEADO, RH, GUARDIA) limita a comentar
    // las tareas propias; con alcance de área o todo, cualquiera del ticket.
    const scopeTasks = scopeOf(user, "tasks.view");
    if ((scopeTasks === "OWN" || scopeTasks === "NONE") && user.id !== assignment.userId) {
      throw new HttpError(403, "COMMENT_ONLY_OWN_TASKS");
    }

    const author = await this.db.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });

    const comment = await this.db.ticketAssignmentComment.create({
      data: { assignmentId, authorId: user.id, text: text.trim() },
      include: { author: { select: { id: true, name: true, username: true } } },
    });

    await this.db.ticketHistory.create({
      data: {
        ticketId,
        type: "UPDATED",
        detail: `Comentario en tarea ${assignment.title} (${author?.name ?? "Sistema"})`,
        authorId: user.id,
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
        ticket: { select: { assignedToId: true } },
      },
    });
    if (!assignment || assignment.ticketId !== ticketId) throw new HttpError(404, "ASSIGNMENT_NOT_FOUND");

    return this.db.$transaction(async (tx) => {
      await tx.ticketAssignment.delete({ where: { id: assignmentId } });

      // Si el asignado era el espejo asignadoAId, se apunta a otra asignación o
      // se limpia.
      if (assignment.ticket.assignedToId === assignment.userId) {
        const next = await tx.ticketAssignment.findFirst({ where: { ticketId } });
        await tx.ticket.update({
          where: { id: ticketId },
          data: { assignedToId: next?.userId ?? null },
        });
      }

      await tx.ticketHistory.create({
        data: {
          ticketId,
          type: "ASSIGNED",
          detail: `Tarea retirada de ${assignment.user.name}`,
          authorId: actorId ?? null,
        },
      });

      broadcastTicketEvent({ type: "UPDATED", ticketId, data: { removedAssignmentId: assignmentId } }).catch(() => {});
      return assignment;
    });
  }
}