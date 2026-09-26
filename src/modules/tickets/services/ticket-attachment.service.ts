import crypto from "crypto";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { env } from "@core/config/env.config";
import { downloadObject, publicObjectUrl, uploadObject } from "@core/services/storage";
import { scopeOf, withinScope, canViewTicket, type UserPermissions } from "@core/permissions";

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
  if (!file) throw new HttpError(400, "FILE_REQUIRED");
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new HttpError(400, "FILE_TYPE_NOT_ALLOWED");
  }
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new HttpError(400, "FILE_TOO_LARGE");
  }
  return file;
};

export class TicketAttachmentService {
  constructor(private readonly db = prismaClient) {}

  private canManageTicket(
    ticket: { createdById: string; assignedToId: string | null; departmentId?: string | null; assignments?: Array<{ userId: string }> },
    actor: UserPermissions
  ) {
    return withinScope(actor, scopeOf(actor, "tickets.edit"), ticket);
  }

  private async canAccessTicket(ticketId: string, actor: UserPermissions) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        createdById: true,
        assignedToId: true,
        departmentId: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND");
    if (!canViewTicket(actor, ticket)) {
      throw new HttpError(403, "FORBIDDEN");
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
    actor: UserPermissions,
    file?: Express.Multer.File,
    kind = "PHOTO"
  ) {
    await this.canAccessTicket(ticketId, actor);
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
    actor: UserPermissions,
    file?: Express.Multer.File,
    kind = "EVIDENCE"
  ) {
    const ticket = await this.canAccessTicket(ticketId, actor);
    const assignment = await this.db.ticketAssignment.findFirst({
      where: { id: assignmentId, ticketId },
      select: { id: true, userId: true },
    });
    if (!assignment) throw new HttpError(404, "TASK_NOT_FOUND");
    const canUpload = this.canManageTicket(ticket, actor) || actor.id === assignment.userId;
    if (!canUpload) throw new HttpError(403, "ONLY_ASSIGNEE_UPLOADS_EVIDENCE");
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

  async listTicketAttachments(ticketId: string, actor: UserPermissions) {
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
    actor: UserPermissions
  ) {
    await this.canAccessTicket(ticketId, actor);
    const assignment = await this.db.ticketAssignment.findFirst({
      where: { id: assignmentId, ticketId },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(404, "TASK_NOT_FOUND");
    const attachments = await this.db.ticketAttachment.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(attachments.map((a) => this.serialize(a)));
  }

  async downloadAttachment(
    ticketId: string,
    attachmentId: string,
    actor: UserPermissions,
    assignmentId?: string
  ) {
    await this.canAccessTicket(ticketId, actor);
    const attachment = await this.db.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId, ...(assignmentId ? { assignmentId } : {}) },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!attachment) throw new HttpError(404, "FILE_NOT_FOUND");
    const body = await downloadObject(attachment.storageKey);
    return { body, mimeType: attachment.mimeType, originalName: attachment.originalName };
  }
}