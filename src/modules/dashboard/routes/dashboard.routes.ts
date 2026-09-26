import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { DashboardSummarySchema } from "../models/dto/dashboard.dto";
import type { DashboardController } from "../controllers/dashboard.controller";

export const createDashboardRouter = (controller: DashboardController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/dashboard/summary",
    tags: ["Dashboard"],
    summary: "KPIs y actividad reciente del dashboard administrativo (ADMIN/GERENTE)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Resumen", content: { "application/json": { schema: DashboardSummarySchema } } },
    },
  });

  router.use(authenticate);
  router.get("/summary", requiresPermission("dashboard.view"), asyncHandler(controller.summary));

  return router;
};
