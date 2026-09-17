import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { TicketService } from "../services/ticket.service";
import { TicketAttachmentService } from "../services/ticket-attachment.service";
import {
  TicketAssignmentCommentSchema,
  TicketAssignmentCreateSchema,
  TicketAssignmentUpdateSchema,
  TicketCommentSchema,
  TicketCreateSchema,
  TicketUpdateSchema,
} from "../models/dto/ticket.dto";

export class TicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly attachmentService: TicketAttachmentService
  ) {}

  private scope(req: Request) {
    return {
      userId: req.user?.id,
      role: req.user?.role,
      departmentId: req.user?.departmentId,
    };
  }

  private actor(req: Request) {
    if (!req.user) throw new HttpError(401, "No autenticado");
    return {
      id: req.user.id,
      role: req.user.role,
      departmentId: req.user.departmentId,
    };
  }

  list = async (req: Request, res: Response) => {
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    const data = await this.ticketService.listTickets(
      req.user!.id,
      req.user!.role,
      search,
      req.user!.departmentId
    );
    res.json({ data, total: data.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.ticketService.listTicketsTable(
      params,
      req.user!.id,
      req.user!.role,
      req.user!.departmentId
    );
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.ticketService.getTicketById(req.params.id, this.scope(req));
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = TicketCreateSchema.parse(req.body);
    const data = await this.ticketService.createTicket({
      ...input,
      creadoPorId: req.user!.id,
      creatorRole: req.user!.role,
      creatorDepartmentId: req.user!.departmentId,
    });
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const raw = TicketUpdateSchema.parse(req.body);
    const input = {
      ...raw,
      asignadoAId: raw.asignadoAId ?? undefined,
      departmentId: raw.departmentId ?? undefined,
    };
    const data = await this.ticketService.updateTicket(req.params.id, input, this.scope(req));
    res.json(data);
  };

  addComment = async (req: Request, res: Response) => {
    const input = TicketCommentSchema.parse(req.body);
    const data = await this.ticketService.addComment(
      req.params.id,
      req.user!.id,
      input.texto,
      this.scope(req)
    );
    res.status(201).json(data);
  };

  kanban = async (req: Request, res: Response) => {
    const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : undefined;
    const data = await this.ticketService.listKanbanAssignments(this.scope(req), ticketId);
    res.json({ data, total: data.length });
  };

  uploadTicketAttachment = async (req: Request, res: Response) => {
    const data = await this.attachmentService.uploadTicketAttachment(
      req.params.id,
      this.actor(req),
      req.file,
      typeof req.body.kind === "string" ? req.body.kind : undefined
    );
    res.status(201).json(data);
  };

  listTicketAttachments = async (req: Request, res: Response) => {
    const data = await this.attachmentService.listTicketAttachments(req.params.id, this.actor(req));
    res.json(data);
  };

  downloadTicketAttachment = async (req: Request, res: Response) => {
    const file = await this.attachmentService.downloadAttachment(
      req.params.id,
      req.params.attachmentId,
      this.actor(req)
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.originalName.replace(/"/g, "")}"`);
    res.send(file.body);
  };

  uploadAssignmentAttachment = async (req: Request, res: Response) => {
    const data = await this.attachmentService.uploadAssignmentAttachment(
      req.params.id,
      req.params.assignmentId,
      this.actor(req),
      req.file,
      typeof req.body.kind === "string" ? req.body.kind : undefined
    );
    res.status(201).json(data);
  };

  listAssignmentAttachments = async (req: Request, res: Response) => {
    const data = await this.attachmentService.listAssignmentAttachments(
      req.params.id,
      req.params.assignmentId,
      this.actor(req)
    );
    res.json(data);
  };

  downloadAssignmentAttachment = async (req: Request, res: Response) => {
    const file = await this.attachmentService.downloadAttachment(
      req.params.id,
      req.params.attachmentId,
      this.actor(req),
      req.params.assignmentId
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.originalName.replace(/"/g, "")}"`);
    res.send(file.body);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.ticketService.deleteTicket(req.params.id, this.scope(req));
    res.json(data);
  };

  addAssignment = async (req: Request, res: Response) => {
    const input = TicketAssignmentCreateSchema.parse(req.body);
    const data = await this.ticketService.addTicketAssignment(
      req.params.id,
      { ...input, description: input.description ?? "" },
      this.scope(req)
    );
    res.status(201).json(data);
  };

  updateAssignment = async (req: Request, res: Response) => {
    const input = TicketAssignmentUpdateSchema.parse(req.body);
    const data = await this.ticketService.updateTicketAssignment(
      req.params.id,
      req.params.assignmentId,
      input,
      this.scope(req)
    );
    res.json(data);
  };

  removeAssignment = async (req: Request, res: Response) => {
    if (req.user?.role === "EMPLEADO") {
      throw new HttpError(403, "Los empleados no pueden retirar tareas");
    }
    if (req.user?.role === "JEFE_DE_AREA") {
      const ticket = await this.ticketService.getTicketById(req.params.id, this.scope(req));
      const inOwnArea = req.user?.departmentId && ticket.departmentId === req.user.departmentId;
      const isManager = ticket.creadoPorId === req.user?.id || ticket.asignadoAId === req.user?.id;
      if (!inOwnArea && !isManager) {
        throw new HttpError(403, "Solo puedes retirar tareas de tickets de tu área");
      }
    }
    const data = await this.ticketService.removeTicketAssignment(
      req.params.id,
      req.params.assignmentId,
      req.user?.id
    );
    res.json(data);
  };

  addAssignmentComment = async (req: Request, res: Response) => {
    const input = TicketAssignmentCommentSchema.parse(req.body);
    const data = await this.ticketService.addAssignmentComment(
      req.params.id,
      req.params.assignmentId,
      input.texto,
      this.scope(req)
    );
    res.status(201).json(data);
  };
}