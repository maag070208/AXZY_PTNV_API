import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import type { UserRole } from "@core/utils/security";
import { OvertimeApprovalSchema, OvertimeQuerySchema } from "../models/dto/overtime.dto";
import type { OvertimeController } from "../controllers/overtime.controller";

// Aprobar tiempo extra es potestad de GERENTES y ADMIN.
const APPROVE_ROLES: UserRole[] = ["ADMIN", "GERENTE"];

const bearer = [{ bearerAuth: [] }];

export const createOvertimeRouter = (controller: OvertimeController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/overtime/query",
    tags: ["Overtime"],
    summary:
      "Tabla server-side de días de tiempo extra (persona + día) con su estado de aprobación (filtros: period, date, tz, departmentId, q, status, includeInactive)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: OvertimeQuerySchema } } } },
    responses: {
      200: { description: "Página de días + resumen" },
      400: { description: "period/date/tz inválidos" },
      403: { description: "Solo ADMIN y GERENTE" },
    },
  });

  registerPath({
    method: "post",
    path: "/overtime/approvals",
    tags: ["Overtime"],
    summary: "Aprobar/rechazar (o revertir a PENDIENTE) días de tiempo extra (ADMIN/GERENTE)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: OvertimeApprovalSchema } } } },
    responses: {
      200: { description: "{ updated, skipped }" },
      400: { description: "Body inválido" },
      403: { description: "Solo ADMIN y GERENTE" },
    },
  });

  router.use(authenticate);

  router.post("/query", authorize(APPROVE_ROLES), asyncHandler(controller.query));
  router.post("/approvals", authorize(APPROVE_ROLES), asyncHandler(controller.decide));

  return router;
};
