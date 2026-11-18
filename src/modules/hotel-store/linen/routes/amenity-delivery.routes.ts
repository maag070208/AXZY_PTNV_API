import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelAmenityDeliveryController } from "../controllers/amenity-delivery.controller";

/** Entrega de amenidades. Mounted by the hotel router under `/linen`. */
export const createHotelAmenityDeliveryRouter = (c: HotelAmenityDeliveryController): Router => {
  const router = Router();
  const delivery = requiresPermission("hotel_linen.amenity_delivery");
  router.post("/amenity-deliveries", delivery, asyncHandler(c.create));
  router.post("/amenity-deliveries/table", delivery, asyncHandler(c.table));
  // Antes de `/:id` para que no se lean como un id.
  router.get("/amenity-deliveries/suggestion", delivery, asyncHandler(c.suggestion));
  router.get("/amenity-deliveries/recipients", delivery, asyncHandler(c.recipients));
  router.get("/amenity-deliveries/history", delivery, asyncHandler(c.history));
  router.get("/amenity-deliveries/:id", delivery, asyncHandler(c.get));
  return router;
};
