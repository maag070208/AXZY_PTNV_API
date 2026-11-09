import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelAmenityController } from "../controllers/amenity.controller";

/** Control semanal de amenidades. Mounted by the hotel router under `/linen`. */
export const createHotelAmenityRouter = (c: HotelAmenityController): Router => {
  const router = Router();
  const view = requiresPermission("hotel_linen.view");
  const control = requiresPermission("hotel_linen.amenities_control");

  router.get("/amenities/weekly/preview", control, asyncHandler(c.preview));
  router.post("/amenities/weekly/table", view, asyncHandler(c.table));
  router.post("/amenities/weekly", control, asyncHandler(c.save));
  router.get("/amenities/weekly/:id", view, asyncHandler(c.get));
  router.post("/amenities/weekly/:id/submit", control, asyncHandler(c.submit));
  router.post("/amenities/weekly/:id/review", control, asyncHandler(c.review));
  // El Gerente de Operaciones no tiene amenities_control: se aprueba por reportes (+ rol en el servicio).
  router.post("/amenities/weekly/:id/acknowledge", requiresAnyPermission(["hotel_linen.amenities_control", "hotel_linen.reports"]), asyncHandler(c.acknowledge));

  router.get("/amenities/low-stock", view, asyncHandler(c.lowStock));
  router.get("/amenities/spa/daily", view, asyncHandler(c.spaDaily));
  return router;
};
