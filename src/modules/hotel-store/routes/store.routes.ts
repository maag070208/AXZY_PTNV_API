import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelStoreController } from "../controllers/store.controller";
import type { HotelInitialLoadController } from "../controllers/initial-load.controller";

/**
 * Warehouse routes (M3). Mounted under `/hotel` after the rooms router, which
 * already applies `authenticate` to the module. Each movement type checks its own
 * permission in the controller (see PERMISSION_BY_TYPE).
 */
export const createHotelStoreRouter = (
  controller: HotelStoreController,
  initialLoad: HotelInitialLoadController
): Router => {
  const router = Router();
  // Excel files are small price/quantity lists; 5 MB is generous.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const view = requiresPermission("hotel_store.view");
  const manage = requiresPermission("hotel_store.manage");
  const move = requiresAnyPermission([
    "hotel_store.stock_in",
    "hotel_store.stock_out",
    "hotel_store.transfer",
    "hotel_store.adjust",
  ]);

  router.get("/warehouses", view, asyncHandler(controller.listWarehouses));
  router.post("/warehouses", manage, asyncHandler(controller.createWarehouse));
  router.patch("/warehouses/:id", manage, asyncHandler(controller.updateWarehouse));
  router.delete("/warehouses/:id", manage, asyncHandler(controller.removeWarehouse));
  router.post("/warehouses/:id/locations", manage, asyncHandler(controller.addLocation));

  router.get("/stock", view, asyncHandler(controller.stockRows));
  router.get("/stock/reconcile", view, asyncHandler(controller.reconcile));

  router.get("/movements", view, asyncHandler(controller.listMovements));
  router.get("/movements/:id", view, asyncHandler(controller.getMovement));
  router.post("/movements", move, asyncHandler(controller.postMovement));
  router.post("/movements/:id/cancel", move, asyncHandler(controller.cancelMovement));

  const stockIn = requiresPermission("hotel_store.stock_in");
  router.get("/initial-load/template", stockIn, asyncHandler(initialLoad.template));
  router.post("/initial-load/preview", stockIn, upload.single("file"), asyncHandler(initialLoad.preview));
  router.post("/initial-load/confirm", stockIn, upload.single("file"), asyncHandler(initialLoad.confirm));

  return router;
};
