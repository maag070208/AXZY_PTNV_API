import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelRoomReviewController } from "../controllers/room-review.controller";

/** Revisión de habitación. Mounted by the hotel router under `/linen`. */
export const createHotelRoomReviewRouter = (c: HotelRoomReviewController): Router => {
  const router = Router();
  const review = requiresPermission("hotel_linen.room_review");
  router.post("/room-reviews", review, asyncHandler(c.create));
  router.post("/room-reviews/table", review, asyncHandler(c.table));
  // Antes de `/:id` para que "consolidated" no se lea como un id.
  router.get("/room-reviews/consolidated", review, asyncHandler(c.consolidated));
  router.get("/room-reviews/:id", review, asyncHandler(c.get));
  router.get("/rooms/:id/reviews", review, asyncHandler(c.history));
  return router;
};
