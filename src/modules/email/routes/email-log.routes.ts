import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
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
    summary: "Email delivery log (server-side table) — ADMIN",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: {
        description: "Page of email_logs (filters: status, action, entityId)",
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/mail/logs/{id}/retry",
    tags: ["Mail"],
    summary: "Requeue a failed/cancelled email to resend it (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Record updated to PENDING", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "The email was already sent (SENT)" },
      404: { description: "Record not found" },
    },
  });

  registerPath({
    method: "post",
    path: "/mail/logs/{id}/cancel",
    tags: ["Mail"],
    summary: "Cancel a pending email without retrying (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Record updated to CANCELLED", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "The email was already sent (SENT)" },
      404: { description: "Record not found" },
    },
  });

  router.use(authenticate);
  router.post("/logs/query", requiresPermission("system.configure"), asyncHandler(controller.table));
  router.post("/logs/:id/retry", requiresPermission("system.configure"), asyncHandler(controller.retry));
  router.post("/logs/:id/cancel", requiresPermission("system.configure"), asyncHandler(controller.cancel));

  return router;
};