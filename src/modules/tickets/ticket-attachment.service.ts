import crypto from "crypto";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { env } from "@core/config/env.config";
import { publicObjectUrl, uploadObject } from "@core/services/storage";

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

type Actor = { id: string; role: string };

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

const canManageTicket = (ticket: { creadoPorId: string }, actor: Actor) =>
  actor.role === "ADMIN" || (actor.role === "JEFE_DE_AREA" && ticket.creadoPorId === actor.id);

const canAccessTicket = async (ticketId: string, actor: Actor) => {
  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      creadoPorId: true,
      asignadoAId: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!ticket) throw new HttpError(404, "Ticket no encontrado");
  const involved =
    ticket.creadoPorId === actor.id ||
    ticket.asignadoAId === actor.id ||
    ticket.assignments.some((assignment) => assignment.userId === actor.id);
  if (!involved && !canManageTicket(ticket, actor)) {
    throw new HttpError(403, "No autorizado");
  }
  return ticket;
};

const serialize = async (attachment: {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  storageKey: string;
  createdAt: Date;
  uploadedById: string;
}) => ({
  id: attachment.id,
  originalName: attachment.originalName,
  mimeType: attachment.mimeType,
  sizeBytes: attachment.sizeBytes,
  kind: attachment.kind,
  createdAt: attachment.createdAt,
  uploadedById: attachment.uploadedById,
  url: publicObjectUrl(attachment.storageKey),
});

export const uploadTicketAttachment = async (
  ticketId: string,
  actor: Actor,
  file?: Express.Multer.File,
  kind = "FOTO"
) => {
  const ticket = await canAccessTicket(ticketId, actor);
  if (actor.role === "EMPLEADO" && ticket.creadoPorId !== actor.id && !ticket.assignments.some((a) => a.userId === actor.id)) {
    throw new HttpError(403, "Solo puedes adjuntar archivos en tickets en los que participas");
  }
  const validFile = assertFile(file);
  const key = `tickets/${ticketId}/${crypto.randomUUID()}-${validFile.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await uploadObject(key, validFile.buffer, validFile.mimetype);
  const attachment = await prismaClient.ticketAttachment.create({
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
  return serialize(attachment);
};

export const uploadAssignmentAttachment = async (
  ticketId: string,
  assignmentId: string,
  actor: Actor,
  file?: Express.Multer.File,
  kind = "EVIDENCIA"
) => {
  const ticket = await canAccessTicket(ticketId, actor);
  const assignment = await prismaClient.ticketAssignment.findFirst({
    where: { id: assignmentId, ticketId },
    select: { id: true, userId: true },
  });
  if (!assignment) throw new HttpError(404, "Tarea no encontrada");
  const canUpload =
    canManageTicket(ticket, actor) ||
    actor.id === assignment.userId;
  if (!canUpload) throw new HttpError(403, "Solo el empleado asignado puede subir evidencia");
  const validFile = assertFile(file);
  const key = `tickets/${ticketId}/tasks/${assignmentId}/${crypto.randomUUID()}-${validFile.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await uploadObject(key, validFile.buffer, validFile.mimetype);
  const attachment = await prismaClient.ticketAttachment.create({
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
  return serialize(attachment);
};

export const listTicketAttachments = async (ticketId: string, actor: Actor) => {
  await canAccessTicket(ticketId, actor);
  const attachments = await prismaClient.ticketAttachment.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(attachments.map(serialize));
};

export const listAssignmentAttachments = async (
  ticketId: string,
  assignmentId: string,
  actor: Actor
) => {
  await canAccessTicket(ticketId, actor);
  const assignment = await prismaClient.ticketAssignment.findFirst({
    where: { id: assignmentId, ticketId },
    select: { id: true },
  });
  if (!assignment) throw new HttpError(404, "Tarea no encontrada");
  const attachments = await prismaClient.ticketAttachment.findMany({
    where: { assignmentId },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(attachments.map(serialize));
};
