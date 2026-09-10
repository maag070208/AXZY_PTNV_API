import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { prismaClient } from "@core/config/database";
import { sendEmail } from "@core/services/mail";
import * as service from "./ticket.service";
import * as attachmentService from "./ticket-attachment.service";

const createSchema = z.object({
  titulo: z.string().min(3).max(150),
  descripcion: z.string().min(3),
  priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
  category: z.enum(["MANTENIMIENTO", "EQUIPO", "SISTEMA", "OTRO"]).optional(),
  departmentId: z.string().optional(),
  asignadoAId: z.string().optional(),
});

const updateSchema = z.object({
  status: z.enum(["ABIERTO", "EN_SEGUIMIENTO", "CERRADO"]).optional(),
  priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
  category: z.enum(["MANTENIMIENTO", "EQUIPO", "SISTEMA", "OTRO"]).optional(),
  asignadoAId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

const commentSchema = z.object({
  texto: z.string().min(1),
});

export const list = async (req: Request, res: Response) => {
  const search = typeof req.query.q === "string" ? req.query.q : undefined;
  const data = await service.listTickets(req.user!.id, req.user!.role, search, req.user!.departmentId);
  res.json({ data, total: data.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listTicketsTable(params, req.user!.id, req.user!.role, req.user!.departmentId);
  res.json({ data, total });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getTicketById(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  if (req.user?.role === "EMPLEADO") {
    throw new HttpError(403, "Los empleados no pueden crear tickets");
  }
  const input = createSchema.parse(req.body);
  const data = await service.createTicket({
    ...input,
    creadoPorId: req.user!.id,
  });
  const admins = await prismaClient.user.findMany({
    where: { role: { in: ["ADMIN", "GERENTE"] }, active: true, email: { not: null } },
    select: { email: true },
  });
  const recipients = admins.map((admin) => admin.email).filter((email): email is string => Boolean(email));
  if (recipients.length) {
    sendEmail({
      to: recipients,
      subject: `Nuevo ticket: ${data.titulo}`,
      html: `<p>Se creó ticket <strong>${data.titulo}</strong>.</p><p>${data.descripcion}</p>`,
    }).catch(() => {});
  }
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const raw = updateSchema.parse(req.body);
  const input = {
    ...raw,
    asignadoAId: raw.asignadoAId ?? undefined,
    departmentId: raw.departmentId ?? undefined,
  };
  const data = await service.updateTicket(req.params.id, input, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.json(data);
};

export const addComment = async (req: Request, res: Response) => {
  const input = commentSchema.parse(req.body);
  const data = await service.addComment(req.params.id, req.user!.id, input.texto);
  res.status(201).json(data);
};

export const kanban = async (req: Request, res: Response) => {
  const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : undefined;
  const data = await service.listKanbanAssignments(req.user?.id, req.user?.role, ticketId);
  res.json({ data, total: data.length });
};

export const uploadTicketAttachment = async (req: Request, res: Response) => {
  if (!req.user) throw new HttpError(401, "No autenticado");
  const data = await attachmentService.uploadTicketAttachment(
    req.params.id,
    { id: req.user.id, role: req.user.role },
    req.file,
    typeof req.body.kind === "string" ? req.body.kind : undefined
  );
  res.status(201).json(data);
};

export const listTicketAttachments = async (req: Request, res: Response) => {
  if (!req.user) throw new HttpError(401, "No autenticado");
  const data = await attachmentService.listTicketAttachments(req.params.id, {
    id: req.user.id,
    role: req.user.role,
  });
  res.json(data);
};

export const uploadAssignmentAttachment = async (req: Request, res: Response) => {
  if (!req.user) throw new HttpError(401, "No autenticado");
  const data = await attachmentService.uploadAssignmentAttachment(
    req.params.id,
    req.params.assignmentId,
    { id: req.user.id, role: req.user.role },
    req.file,
    typeof req.body.kind === "string" ? req.body.kind : undefined
  );
  res.status(201).json(data);
};

export const listAssignmentAttachments = async (req: Request, res: Response) => {
  if (!req.user) throw new HttpError(401, "No autenticado");
  const data = await attachmentService.listAssignmentAttachments(
    req.params.id,
    req.params.assignmentId,
    { id: req.user.id, role: req.user.role }
  );
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteTicket(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.json(data);
};

const assignmentSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(""),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

const assignmentUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(["PENDIENTE", "EN_PROGRESO", "EN_REVISION", "COMPLETADA"]).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

const assignmentCommentSchema = z.object({
  texto: z.string().min(1).max(1000),
});

export const addAssignment = async (req: Request, res: Response) => {
  if (req.user?.role === "EMPLEADO") {
    throw new HttpError(403, "Los empleados no pueden asignar tareas");
  }
  if (req.user?.role === "JEFE_DE_AREA") {
    const ticket = await service.getTicketById(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
    if (ticket.creadoPorId !== req.user?.id) {
      throw new HttpError(403, "Solo puedes asignar tareas en tickets que tú creaste");
    }
  }
  const input = assignmentSchema.parse(req.body);
  const data = await service.addTicketAssignment(req.params.id, input, req.user?.id);
  res.status(201).json(data);
};

export const updateAssignment = async (req: Request, res: Response) => {
  if (req.user?.role === "JEFE_DE_AREA") {
    const ticket = await service.getTicketById(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
    if (ticket.creadoPorId !== req.user?.id) {
      throw new HttpError(403, "Solo puedes editar tareas en tickets que tú creaste");
    }
  }
  const input = assignmentUpdateSchema.parse(req.body);
  const data = await service.updateTicketAssignment(
    req.params.id,
    req.params.assignmentId,
    input,
    req.user?.id,
    req.user?.role
  );
  res.json(data);
};

export const removeAssignment = async (req: Request, res: Response) => {
  if (req.user?.role === "EMPLEADO") {
    throw new HttpError(403, "Los empleados no pueden retirar tareas");
  }
  if (req.user?.role === "JEFE_DE_AREA") {
    const ticket = await service.getTicketById(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
    if (ticket.creadoPorId !== req.user?.id) {
      throw new HttpError(403, "Solo puedes retirar tareas en tickets que tú creaste");
    }
  }
  const data = await service.removeTicketAssignment(
    req.params.id,
    req.params.assignmentId,
    req.user?.id
  );
  res.json(data);
};

export const addAssignmentComment = async (req: Request, res: Response) => {
  const input = assignmentCommentSchema.parse(req.body);
  const data = await service.addAssignmentComment(
    req.params.id,
    req.params.assignmentId,
    input.texto,
    req.user?.id,
    req.user?.role
  );
  res.status(201).json(data);
};
