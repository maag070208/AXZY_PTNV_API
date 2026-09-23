import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import type { EmailLogController } from "../controllers/email-log.controller";

const bearer = [{ bearerAuth: [] }];

export const createEmailLogRoutes = (controller: EmailLogController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/mail/logs/query",
    tags: ["Mail"],
    summary: "Bitácora de envíos de correo (server-side table) — ADMIN",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: {
        description: "Página de email_logs (filtros: status, action, entityId)",
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/mail/logs/{id}/retry",
    tags: ["Mail"],
    summary: "Reencolar un correo fallido/cancelado para reenviarlo (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Registro actualizado a PENDING", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "El correo ya fue enviado (SENT)" },
      404: { description: "Registro no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/mail/logs/{id}/cancel",
    tags: ["Mail"],
    summary: "Cancelar un correo pendiente sin reintentar (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Registro actualizado a CANCELLED", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "El correo ya fue enviado (SENT)" },
      404: { description: "Registro no encontrado" },
    },
  });

  router.use(authenticate);
  router.post("/logs/query", authorize(["ADMIN"]), asyncHandler(controller.table));
  router.post("/logs/:id/retry", authorize(["ADMIN"]), asyncHandler(controller.retry));
  router.post("/logs/:id/cancel", authorize(["ADMIN"]), asyncHandler(controller.cancel));

  return router;
};