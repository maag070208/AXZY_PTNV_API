import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelHousekeepingController } from "../controllers/housekeeping.controller";

/** Housekeeping tasks (M5). Mounted under `/hotel`; scope is checked in the controller. */
export const createHotelHousekeepingRouter = (controller: HotelHousekeepingController): Router => {
  const router = Router();
  const operate = requiresPermission("housekeeping.operate");
  const assign = requiresPermission("housekeeping.assign");
  const view = requiresAnyPermission(["housekeeping.operate", "housekeeping.assign", "housekeeping.inspect"]);

  router.get("/tasks", view, asyncHandler(controller.list));
  router.post("/tasks", assign, asyncHandler(controller.create));
  router.get("/tasks/:id", view, asyncHandler(controller.get));
  router.patch("/tasks/:id/assign", assign, asyncHandler(controller.assign));
  router.post("/tasks/:id/start", operate, asyncHandler(controller.start));
  router.post("/tasks/:id/lines", operate, asyncHandler(controller.addExtra));
  router.post("/tasks/:id/finish", operate, asyncHandler(controller.finish));
  router.post("/tasks/:id/cancel", assign, asyncHandler(controller.cancel));
  router.post("/tasks/:id/inspect", requiresPermission("housekeeping.inspect"), asyncHandler(controller.inspect));

  return router;
};
