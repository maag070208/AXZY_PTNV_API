import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import multer from "multer";
import {
  KanbanResponseSchema,
  TicketAttachmentSchema,
  TicketAssignmentCommentSchema,
  TicketAssignmentCreateSchema,
  TicketAssignmentUpdateSchema,
  TicketCategoryCreateDto,
  TicketCategorySchema,
  TicketCategoryUpdateDto,
  TicketCommentSchema,
  TicketCreateSchema,
  TicketDeleteResponseSchema,
  TicketListResponseSchema,
  TicketQueryListSchema,
  TicketSchema,
  TicketTableResponseSchema,
  TicketUpdateSchema,
} from "../models/dto/ticket.dto";
import type { TicketController } from "../controllers/ticket.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const bearer = [{ bearerAuth: [] }];

export const createTicketsRouter = (controller: TicketController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/tickets",
    tags: ["Tickets"],
    summary: "Listar tickets del usuario (según rol/scope)",
    security: bearer,
    parameters: [
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Lista", content: { "application/json": { schema: TicketListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/kanban",
    tags: ["Tickets"],
    summary: "Asignaciones para kanban",
    security: bearer,
    parameters: [
      { in: "query", name: "ticketId", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Asignaciones", content: { "application/json": { schema: KanbanResponseSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/query",
    tags: ["Tickets"],
    summary: "Tabla server-side de tickets",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TicketQueryListSchema } } } },
    responses: {
      200: { description: "Página de tickets", content: { "application/json": { schema: TicketTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/categories",
    tags: ["Tickets"],
    summary: "Listar categorías de ticket",
    security: bearer,
    parameters: [
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Categorías", content: { "application/json": { schema: TicketCategorySchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/categories",
    tags: ["Tickets"],
    summary: "Crear categoría de ticket",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TicketCategoryCreateDto } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: TicketCategorySchema } } },
    },
  });

  registerPath({
    method: "patch",
    path: "/tickets/categories/{id}",
    tags: ["Tickets"],
    summary: "Actualizar categoría de ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TicketCategoryUpdateDto } } } },
    responses: {
      200: { description: "Actualizada", content: { "application/json": { schema: TicketCategorySchema } } },
    },
  });

  registerPath({
    method: "delete",
    path: "/tickets/categories/{id}",
    tags: ["Tickets"],
    summary: "Desactivar/eliminar categoría de ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Resultado" },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/{id}",
    tags: ["Tickets"],
    summary: "Detalle de un ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Ticket", content: { "application/json": { schema: TicketSchema } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets",
    tags: ["Tickets"],
    summary: "Crear ticket",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TicketCreateSchema } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: TicketSchema } } },
      400: { description: "Datos inválidos" },
      403: { description: "No autorizado" },
    },
  });

  registerPath({
    method: "put",
    path: "/tickets/{id}",
    tags: ["Tickets"],
    summary: "Actualizar ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TicketUpdateSchema } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: TicketSchema } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/tickets/{id}",
    tags: ["Tickets"],
    summary: "Eliminar ticket (solo ADMIN; soft primero, luego físico)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Eliminado", content: { "application/json": { schema: TicketDeleteResponseSchema } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/{id}/comments",
    tags: ["Tickets"],
    summary: "Comentar en un ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TicketCommentSchema } } } },
    responses: {
      201: { description: "Comentario creado" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/{id}/assignments",
    tags: ["Tickets"],
    summary: "Crear tarea asignada en un ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TicketAssignmentCreateSchema } } } },
    responses: {
      201: { description: "Tarea creada" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
      409: { description: "El empleado ya tiene tarea en este ticket" },
    },
  });

  registerPath({
    method: "put",
    path: "/tickets/{id}/assignments/{assignmentId}",
    tags: ["Tickets"],
    summary: "Actualizar tarea",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
    ],
    request: { body: { required: true, content: { "application/json": { schema: TicketAssignmentUpdateSchema } } } },
    responses: {
      200: { description: "Tarea actualizada" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/tickets/{id}/assignments/{assignmentId}",
    tags: ["Tickets"],
    summary: "Retirar tarea",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Tarea retirada" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/{id}/assignments/{assignmentId}/comments",
    tags: ["Tickets"],
    summary: "Comentar en una tarea",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
    ],
    request: { body: { required: true, content: { "application/json": { schema: TicketAssignmentCommentSchema } } } },
    responses: {
      201: { description: "Comentario creado" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/{id}/attachments",
    tags: ["Tickets"],
    summary: "Adjuntos del ticket",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Lista", content: { "application/json": { schema: TicketAttachmentSchema.array() } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/{id}/attachments",
    tags: ["Tickets"],
    summary: "Subir adjunto al ticket (multipart file, 50MB máx)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: {
      body: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                file: { type: "string", format: "binary" },
                kind: { type: "string" },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: "Adjunto subido", content: { "application/json": { schema: TicketAttachmentSchema } } },
      400: { description: "Archivo no permitido o excede el tamaño" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/{id}/attachments/{attachmentId}/download",
    tags: ["Tickets"],
    summary: "Descargar adjunto del ticket",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "attachmentId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Archivo binario" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/{id}/assignments/{assignmentId}/attachments",
    tags: ["Tickets"],
    summary: "Adjuntos de una tarea",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Lista", content: { "application/json": { schema: TicketAttachmentSchema.array() } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/tickets/{id}/assignments/{assignmentId}/attachments",
    tags: ["Tickets"],
    summary: "Subir evidencia a una tarea (multipart file, 50MB máx)",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                file: { type: "string", format: "binary" },
                kind: { type: "string" },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: "Adjunto subido", content: { "application/json": { schema: TicketAttachmentSchema } } },
      400: { description: "Archivo no permitido o excede el tamaño" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/tickets/{id}/assignments/{assignmentId}/attachments/{attachmentId}/download",
    tags: ["Tickets"],
    summary: "Descargar evidencia de una tarea",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "assignmentId", required: true, schema: { type: "string" } },
      { in: "path", name: "attachmentId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Archivo binario" },
      403: { description: "No autorizado" },
      404: { description: "No encontrado" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.get("/kanban", asyncHandler(controller.kanban));
  router.post("/query", asyncHandler(controller.table));
  // Catálogo de categorías: antes de "/:id" para no colisionar.
  router.get("/categories", asyncHandler(controller.listCategories));
  router.post("/categories", requiresPermission("catalogs.manage"), asyncHandler(controller.createCategory));
  router.patch("/categories/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateCategory));
  router.delete("/categories/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.removeCategory));
  router.get("/:id/attachments", asyncHandler(controller.listTicketAttachments));
  router.get("/:id/attachments/:attachmentId/download", asyncHandler(controller.downloadTicketAttachment));
  router.post("/:id/attachments", upload.single("file"), asyncHandler(controller.uploadTicketAttachment));
  router.get("/:id", asyncHandler(controller.getOne));
  router.post("/", asyncHandler(controller.create));
  router.put("/:id", asyncHandler(controller.update));
  router.delete("/:id", requiresPermission("tickets.delete"), asyncHandler(controller.remove));
  router.post("/:id/comments", asyncHandler(controller.addComment));
  router.post("/:id/assignments", asyncHandler(controller.addAssignment));
  router.put("/:id/assignments/:assignmentId", asyncHandler(controller.updateAssignment));
  router.delete("/:id/assignments/:assignmentId", asyncHandler(controller.removeAssignment));
  router.get("/:id/assignments/:assignmentId/attachments", asyncHandler(controller.listAssignmentAttachments));
  router.get("/:id/assignments/:assignmentId/attachments/:attachmentId/download", asyncHandler(controller.downloadAssignmentAttachment));
  router.post("/:id/assignments/:assignmentId/attachments", upload.single("file"), asyncHandler(controller.uploadAssignmentAttachment));
  router.post("/:id/assignments/:assignmentId/comments", asyncHandler(controller.addAssignmentComment));

  return router;
};