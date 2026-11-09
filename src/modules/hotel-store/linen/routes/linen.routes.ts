import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelSignatureController } from "../controllers/signature.controller";
import type { HotelLinenController } from "../controllers/linen.controller";

/** Linen submodule (Blancos). Mounted by the hotel router under `/linen`. */
export const createHotelLinenRouter = (signatures: HotelSignatureController, linen: HotelLinenController): Router => {
  const router = Router();
  const view = requiresPermission("hotel_linen.view");

  router.post("/signatures/cosign", view, asyncHandler(signatures.cosign));

  router.get("/stock/summary", view, asyncHandler(linen.stockSummary));
  router.get("/lots", view, asyncHandler(linen.lots));

  router.post("/transfers", requiresPermission("hotel_linen.transfer_send"), asyncHandler(linen.sendTransfer));
  router.post("/transfers/table", view, asyncHandler(linen.transferTable));
  router.get("/transfers/:id", view, asyncHandler(linen.getTransfer));
  router.post("/transfers/:id/receive", requiresPermission("hotel_linen.transfer_receive"), asyncHandler(linen.receiveTransfer));
  router.post("/transfers/:id/cancel", requiresAnyPermission(["hotel_linen.transfer_send", "hotel_store.adjust_approve"]), asyncHandler(linen.cancelTransfer));

  const manage = requiresPermission("hotel_store.manage");
  router.get("/warehouses/:id/limits", manage, asyncHandler(linen.getLimits));
  router.put("/warehouses/:id/limits", manage, asyncHandler(linen.setLimits));

  return router;
};
