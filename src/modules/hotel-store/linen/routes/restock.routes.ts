import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import { forbidFloorAssistant } from "./role-scope.middleware";
import type { HotelRestockController } from "../controllers/restock.controller";

/** Reposición por dotación y flujo de blancos. Mounted by the hotel router under `/linen`. */
export const createHotelRestockRouter = (c: HotelRestockController): Router => {
  const router = Router();
  const request = requiresPermission("hotel_linen.request");
  router.get("/restock", request, asyncHandler(c.compute));
  router.post("/restock/request", request, asyncHandler(c.createRequest));
  router.get("/flow", requiresPermission("hotel_linen.view"), forbidFloorAssistant, asyncHandler(c.board));
  return router;
};
