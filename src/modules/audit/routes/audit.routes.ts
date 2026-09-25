import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { AuditLogListResponseSchema, AuditLogSchema } from "../models/dto/audit.dto";
import type { AuditController } from "../controllers/audit.controller";

const bearer = [{ bearerAuth: [] }];

export const createAuditRouter = (controller: AuditController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/audit",
    tags: ["Audit"],
    summary: "Listar logs de auditoría filtrados",
    security: bearer,
    parameters: [
      { in: "query", name: "action", required: false, schema: { type: "string" } },
      { in: "query", name: "entityType", required: false, schema: { type: "string" } },
      { in: "query", name: "userId", required: false, schema: { type: "string" } },
      { in: "query", name: "deviceId", required: false, schema: { type: "string" } },
      { in: "query", name: "start", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "end", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1 } },
      { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } },
    ],
    responses: {
      200: { description: "Logs paginados", content: { "application/json": { schema: AuditLogListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/audit/{id}",
    tags: ["Audit"],
    summary: "Obtener log de auditoría por id",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Log", content: { "application/json": { schema: AuditLogSchema } } },
      404: { description: "No encontrado" },
    },
  });

  router.use(authenticate, requierePermiso("auditoria.ver"));

  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.getOne));

  return router;
};