import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelLaundryController } from "../controllers/laundry.controller";

/** Ciclo de lavandería de Blancos. Mounted by the hotel router under `/linen` (después del router base). */
export const createHotelLaundryRouter = (c: HotelLaundryController): Router => {
  const router = Router();
  const view = requiresPermission("hotel_linen.view");
  const request = requiresPermission("hotel_linen.request");

  router.post("/first-wash", requiresPermission("hotel_linen.transfer_send"), asyncHandler(c.firstWash));
  router.post("/supplier-returns", requiresPermission("hotel_linen.transfer_send"), asyncHandler(c.supplierReturn));

  router.post("/laundry/process", requiresPermission("hotel_linen.process"), asyncHandler(c.process));
  router.get("/laundry/board", view, asyncHandler(c.board));

  router.get("/supply-requests/suggestion", view, asyncHandler(c.suggestion));
  router.post("/supply-requests/table", view, asyncHandler(c.requestTable));
  router.post("/supply-requests", request, asyncHandler(c.createRequest));
  router.get("/supply-requests/:id", view, asyncHandler(c.getRequest));
  router.post("/supply-requests/:id/submit", request, asyncHandler(c.submitRequest));
  router.post("/supply-requests/:id/cancel", request, asyncHandler(c.cancelRequest));
  router.post("/supply-requests/:id/fulfill", requiresPermission("hotel_linen.fulfill"), asyncHandler(c.fulfillRequest));
  router.post("/supply-requests/:id/confirm", request, asyncHandler(c.confirmRequest));

  router.get("/dirty-receipts/prefill", view, asyncHandler(c.dirtyReceiptPrefill));
  router.post("/dirty-receipts/table", view, asyncHandler(c.dirtyReceiptTable));
  router.post("/dirty-receipts", requiresPermission("hotel_linen.dirty_receive"), asyncHandler(c.createDirtyReceipt));
  router.get("/dirty-receipts/:id", view, asyncHandler(c.getDirtyReceipt));

  router.get("/reconciliation/daily", view, asyncHandler(c.dailyReconciliation));

  return router;
};
