import crypto from "crypto";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { env } from "@core/config/env.config";
import { downloadObject, publicObjectUrl, uploadObject } from "@core/services/storage";
import type { TicketActor } from "../models/entity/ticket.entity";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/3gpp",
  "video/webm",
]);

const assertFile = (file?: Express.Multer.File) => {
  if (!file) throw new HttpError(400, "Archivo requerido");
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new HttpError(400, "Tipo de archivo no permitido");
  }
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new HttpError(400, "Archivo excede el tamaño máximo permitido");
  }
  return file;
};

export class TicketAttachmentService {
  constructor(private readonly db = prismaClient) {}

  private canManageTicket(ticket: { creadoPorId: string; departmentId?: string | null }, actor: TicketActor) {
    return actor.role === "ADMIN" ||
      (actor.role === "GERENTE" && ticket.departmentId === actor.departmentId) ||
      (actor.role === "JEFE_DE_AREA" && ticket.creadoPorId === actor.id);
  }

  private async canAccessTicket(ticketId: string, actor: TicketActor) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        creadoPorId: true,
        asignadoAId: true,
        departmentId: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!ticket) throw new HttpError(404, "Ticket no encontrado");
    const involved =
      ticket.creadoPorId === actor.id ||
      ticket.asignadoAId === actor.id ||
      ticket.assignments.some((assignment) => assignment.userId === actor.id);
    const inDepartment = !!actor.departmentId && ticket.departmentId === actor.departmentId &&
      (actor.role === "GERENTE" || actor.role === "JEFE_DE_AREA");
    if (!involved && !inDepartment && !this.canManageTicket(ticket, actor)) {
      throw new HttpError(403, "No autorizado");
    }
    return ticket;
  }

  private async serialize(attachment: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    kind: string;
    storageKey: string;
    createdAt: Date;
    uploadedById: string;
    assignmentId?: string | null;
  }) {
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind,
      createdAt: attachment.createdAt,
      uploadedById: attachment.uploadedById,
      assignmentId: attachment.assignmentId ?? null,
      url: publicObjectUrl(attachment.storageKey),
    };
  }

  async uploadTicketAttachment(
    ticketId: string,
    actor: TicketActor,
    file?: Express.Multer.File,
    kind = "FOTO"
  ) {
    const ticket = await this.canAccessTicket(ticketId, actor);
    if (actor.role === "EMPLEADO" && ticket.creadoPorId !== actor.id && !ticket.assignments.some((a) => a.userId === actor.id)) {
      throw new HttpError(403, "Solo puedes adjuntar archivos en tickets en los que participas");
    }
    const validFile = assertFile(file);
    const key = `tickets/${ticketId}/${crypto.randomUUID()}-${validFile.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await uploadObject(key, validFile.buffer, validFile.mimetype);
    const attachment = await this.db.ticketAttachment.create({
      data: {
        ticketId,
        uploadedById: actor.id,
        storageKey: key,
        originalName: validFile.originalname,
        mimeType: validFile.mimetype,
        sizeBytes: validFile.size,
        kind,
      },
    });
    return this.serialize(attachment);
  }

  async uploadAssignmentAttachment(
    ticketId: string,
    assignmentId: string,
    actor: TicketActor,
    file?: Express.Multer.File,
    kind = "EVIDENCIA"
  ) {
    const ticket = await this.canAccessTicket(ticketId, actor);
    const assignment = await this.db.ticketAssignment.findFirst({
      where: { id: assignmentId, ticketId },
      select: { id: true, userId: true },
    });
    if (!assignment) throw new HttpError(404, "Tarea no encontrada");
    const canUpload = this.canManageTicket(ticket, actor) || actor.id === assignment.userId;
    if (!canUpload) throw new HttpError(403, "Solo el empleado asignado puede subir evidencia");
    const validFile = assertFile(file);
    const key = `tickets/${ticketId}/tasks/${assignmentId}/${crypto.randomUUID()}-${validFile.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await uploadObject(key, validFile.buffer, validFile.mimetype);
    const attachment = await this.db.ticketAttachment.create({
      data: {
        ticketId,
        assignmentId,
        uploadedById: actor.id,
        storageKey: key,
        originalName: validFile.originalname,
        mimeType: validFile.mimetype,
        sizeBytes: validFile.size,
        kind,
      },
    });
    return this.serialize(attachment);
  }

  async listTicketAttachments(ticketId: string, actor: TicketActor) {
    await this.canAccessTicket(ticketId, actor);
    const attachments = await this.db.ticketAttachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(attachments.map((a) => this.serialize(a)));
  }

  async listAssignmentAttachments(
    ticketId: string,
    assignmentId: string,
    actor: TicketActor
  ) {
    await this.canAccessTicket(ticketId, actor);
    const assignment = await this.db.ticketAssignment.findFirst({
      where: { id: assignmentId, ticketId },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(404, "Tarea no encontrada");
    const attachments = await this.db.ticketAttachment.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(attachments.map((a) => this.serialize(a)));
  }

  async downloadAttachment(
    ticketId: string,
    attachmentId: string,
    actor: TicketActor,
    assignmentId?: string
  ) {
    await this.canAccessTicket(ticketId, actor);
    const attachment = await this.db.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId, ...(assignmentId ? { assignmentId } : {}) },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!attachment) throw new HttpError(404, "Archivo no encontrado");
    const body = await downloadObject(attachment.storageKey);
    return { body, mimeType: attachment.mimeType, originalName: attachment.originalName };
  }
}