import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelTransferSignoffController } from "../controllers/signoff.controller";

/** 2ª firma en limpio a área. Mounted by the hotel router under `/linen`. */
export const createHotelTransferSignoffRouter = (c: HotelTransferSignoffController): Router => {
  const router = Router();
  const signoff = requiresPermission("hotel_linen.transfer_signoff");
  router.post("/transfers/signoff/table", signoff, asyncHandler(c.table));
  router.post("/transfers/:id/signoff", signoff, asyncHandler(c.sign));
  return router;
};
