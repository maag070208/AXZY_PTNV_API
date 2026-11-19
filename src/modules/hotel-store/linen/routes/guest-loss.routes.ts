import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelGuestLossController } from "../controllers/guest-loss.controller";

/**
 * Pérdidas por huésped. Mismo permiso que solicitar una baja (`writeoff_request`): la baja G
 * sigue la revisión y autorización de siempre. Mounted by the hotel router under `/linen`.
 */
export const createHotelGuestLossRouter = (c: HotelGuestLossController): Router => {
  const router = Router();
  const request = requiresPermission("hotel_linen.writeoff_request");

  router.post("/guest-losses", request, asyncHandler(c.create));
  router.post("/loans/:folio/guest-loss", request, asyncHandler(c.fromLoan));
  router.post("/extras/:id/guest-loss", request, asyncHandler(c.fromExtra));

  return router;
};
