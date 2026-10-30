import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelCatalogController } from "../controllers/catalog.controller";

/**
 * M2 catalog. Mounted after `createHotelRoomsRouter` under `/hotel`, which
 * already applies `authenticate` to every route of the module.
 * Reads: anyone who manages the store or views rooms (to build kits).
 */
export const createHotelCatalogRouter = (controller: HotelCatalogController): Router => {
  const router = Router();
  const read = requiresAnyPermission(["hotel_store.manage", "hotel_rooms.view"]);

  router.get("/units", read, asyncHandler(controller.units));
  router.post("/units", requiresPermission("hotel_store.manage"), asyncHandler(controller.createUnit));
  router.patch("/units/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.updateUnit));
  router.delete("/units/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.removeUnit));

  router.get("/categories", read, asyncHandler(controller.categories));
  router.post("/categories", requiresPermission("hotel_store.manage"), asyncHandler(controller.createCategory));
  router.patch("/categories/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.updateCategory));
  router.delete("/categories/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.removeCategory));

  router.get("/products", read, asyncHandler(controller.products));
  router.post("/products", requiresPermission("hotel_store.manage"), asyncHandler(controller.createProduct));
  router.patch("/products/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.updateProduct));
  router.delete("/products/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.removeProduct));

  router.get("/kits", requiresPermission("hotel_rooms.view"), asyncHandler(controller.kits));
  router.post("/kits", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.createKit));
  router.patch("/kits/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.updateKit));
  router.delete("/kits/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.removeKit));
  router.get("/kits/:id/lines", requiresPermission("hotel_rooms.view"), asyncHandler(controller.kitLines));
  router.put("/kits/:id/lines", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.setKitLines));

  return router;
};
