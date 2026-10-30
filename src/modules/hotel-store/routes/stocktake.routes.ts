import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelStocktakeController } from "../controllers/stocktake.controller";

/** Physical counts (M4). Mounted under `/hotel` after the other routers. */
export const createHotelStocktakeRouter = (controller: HotelStocktakeController): Router => {
  const router = Router();
  const stocktake = requiresPermission("hotel_store.stocktake");
  const approve = requiresPermission("hotel_store.adjust_approve");

  router.get("/stocktakes", stocktake, asyncHandler(controller.list));
  router.post("/stocktakes", stocktake, asyncHandler(controller.create));
  router.get("/stocktakes/:id", stocktake, asyncHandler(controller.get));
  router.post("/stocktakes/:id/start", stocktake, asyncHandler(controller.start));
  router.put("/stocktakes/:id/lines", stocktake, asyncHandler(controller.capture));
  router.post("/stocktakes/:id/close-count", stocktake, asyncHandler(controller.close));
  router.post("/stocktakes/:id/approve", approve, asyncHandler(controller.approve));
  router.post("/stocktakes/:id/cancel", stocktake, asyncHandler(controller.cancel));

  return router;
};
