import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { OvertimeApprovalSchema, OvertimeQuerySchema } from "../models/dto/overtime.dto";
import type { OvertimeController } from "../controllers/overtime.controller";

const bearer = [{ bearerAuth: [] }];

export const createOvertimeRouter = (controller: OvertimeController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/overtime/query",
    tags: ["Overtime"],
    summary:
      "Server-side table of overtime days (person + day) with their approval status (filters: period, date, tz, departmentId, q, status, includeInactive). HR only gets APPROVED, regardless of the requested status",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: OvertimeQuerySchema } } } },
    responses: {
      200: { description: "Page of days + summary (HR: APPROVED only)" },
      400: { description: "Invalid period/date/tz" },
      403: { description: "ADMIN, MANAGER and HUMAN_RESOURCES only" },
    },
  });

  registerPath({
    method: "post",
    path: "/overtime/approvals",
    tags: ["Overtime"],
    summary: "Approve/reject (or revert to PENDING) overtime days (ADMIN/MANAGER)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: OvertimeApprovalSchema } } } },
    responses: {
      200: { description: "{ updated, skipped }" },
      400: { description: "Invalid body" },
      403: { description: "ADMIN and MANAGER only" },
    },
  });

  router.use(authenticate);

  router.post("/query", requiresPermission("overtime.view"), asyncHandler(controller.query));
  router.post("/approvals", requiresPermission("overtime.approve"), asyncHandler(controller.decide));

  return router;
};
