import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelRoomParController } from "../controllers/room-par.controller";

/** Dotación por componente. Mounted by the hotel router under `/linen`. */
export const createHotelRoomParRouter = (c: HotelRoomParController): Router => {
  const router = Router();
  router.get("/room-pars", requiresPermission("hotel_linen.view"), asyncHandler(c.list));
  router.put("/room-pars", requiresPermission("hotel_linen.room_par"), asyncHandler(c.save));
  router.get("/rooms/:id/expected", requiresPermission("hotel_linen.view"), asyncHandler(c.expected));
  return router;
};
