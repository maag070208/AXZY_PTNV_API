import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import { forbidFloorAssistant } from "./role-scope.middleware";
import type { HotelLaundryController } from "../controllers/laundry.controller";

/** Ciclo de lavandería de Blancos. Mounted by the hotel router under `/linen` (después del router base). */
export const createHotelLaundryRouter = (c: HotelLaundryController): Router => {
  const router = Router();
  const view = [requiresPermission("hotel_linen.view"), forbidFloorAssistant];
  const request = requiresPermission("hotel_linen.request");

  router.post("/first-wash", requiresPermission("hotel_linen.transfer_send"), asyncHandler(c.firstWash));
  router.post("/supplier-returns", requiresPermission("hotel_linen.transfer_send"), asyncHandler(c.supplierReturn));

  router.post("/laundry/process", requiresPermission("hotel_linen.process"), asyncHandler(c.process));
  router.get("/laundry/board", view, asyncHandler(c.board));

  // Tablet: la auxiliar de piso solo ve su cola, recoge y entrega (no pasa por `view`).
  router.get("/rooms/:id/turnover-suggestion", request, asyncHandler(c.turnoverSuggestion));
  router.post("/supply-requests/room-turnover", request, asyncHandler(c.roomTurnover));
  router.get(
    "/supply-requests/queue",
    requiresAnyPermission(["hotel_linen.fulfill", "hotel_linen.request", "hotel_linen.carry"]),
    asyncHandler(c.requestQueue)
  );
  const anyQueue = requiresAnyPermission(["hotel_linen.fulfill", "hotel_linen.request", "hotel_linen.carry"]);
  router.get("/supply-requests/today", anyQueue, asyncHandler(c.requestsToday));
  router.get("/supply-requests/history", anyQueue, asyncHandler(c.requestsHistory));
  // Antes de las rutas con `:id`, para que "pickup" no se tome como un id.
  router.post("/supply-requests/pickup", requiresPermission("hotel_linen.carry"), asyncHandler(c.pickupMany));
  router.post("/supply-requests/:id/pickup", requiresPermission("hotel_linen.carry"), asyncHandler(c.pickupRequest));
  router.post("/supply-requests/:id/deliver", requiresPermission("hotel_linen.carry"), asyncHandler(c.deliverRequest));

  router.get("/supply-requests/suggestion", view, asyncHandler(c.suggestion));
  router.post("/supply-requests/table", view, asyncHandler(c.requestTable));
  router.post("/supply-requests", request, asyncHandler(c.createRequest));
  router.get("/supply-requests/:id", view, asyncHandler(c.getRequest));
  router.post("/supply-requests/:id/submit", request, asyncHandler(c.submitRequest));
  router.post("/supply-requests/:id/cancel", request, asyncHandler(c.cancelRequest));
  router.post("/supply-requests/:id/fulfill", requiresPermission("hotel_linen.fulfill"), asyncHandler(c.fulfillRequest));
  router.post("/supply-requests/:id/confirm", request, asyncHandler(c.confirmRequest));
  router.post("/supply-requests/:id/lines", request, asyncHandler(c.addRequestLines));
  router.post("/supply-requests/:id/difference", request, asyncHandler(c.reportDifference));

  router.get("/dirty-receipts/prefill", view, asyncHandler(c.dirtyReceiptPrefill));
  router.post("/dirty-receipts/table", view, asyncHandler(c.dirtyReceiptTable));
  router.post("/dirty-receipts", requiresPermission("hotel_linen.dirty_receive"), asyncHandler(c.createDirtyReceipt));
  router.get("/dirty-receipts/:id", view, asyncHandler(c.getDirtyReceipt));

  router.get("/reconciliation/daily", view, asyncHandler(c.dailyReconciliation));

  return router;
};
