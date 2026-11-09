import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelLinenReportController } from "../controllers/report.controller";

/** Reportes y tablero de blancos. Mounted by the hotel router under `/linen`. */
export const createHotelLinenReportRouter = (c: HotelLinenReportController): Router => {
  const router = Router();
  const reports = requiresPermission("hotel_linen.reports");

  router.get("/dashboard", requiresPermission("hotel_linen.view"), asyncHandler(c.dashboard));
  router.get("/reports/par", reports, asyncHandler(c.par));
  router.get("/reports/condition", reports, asyncHandler(c.condition));
  router.get("/reports/shrinkage", reports, asyncHandler(c.shrinkage));
  router.get("/reports/laundry", reports, asyncHandler(c.laundry));
  router.get("/reports/area-reconciliation", reports, asyncHandler(c.areaReconciliation));
  router.get("/reports/kardex", reports, asyncHandler(c.kardex));

  return router;
};
