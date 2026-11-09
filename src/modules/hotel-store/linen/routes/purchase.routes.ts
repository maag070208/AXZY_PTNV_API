import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelPurchaseController } from "../controllers/purchase.controller";

/** Compras de blancos. Mounted by the hotel router under `/linen` (rutas `/linen/purchases/*`). */
export const createHotelPurchaseRouter = (c: HotelPurchaseController): Router => {
  const router = Router();
  const view = requiresPermission("hotel_purchase.view");
  const create = requiresPermission("hotel_purchase.create");
  const approve = requiresPermission("hotel_purchase.approve");
  const receive = requiresPermission("hotel_purchase.receive");

  // Las rutas fijas van antes de `/:id`.
  router.get("/purchases/lookups", view, asyncHandler(c.lookups));
  router.post("/purchases/table", view, asyncHandler(c.orderTable));
  router.post("/purchases/holds/table", view, asyncHandler(c.holdTable));
  router.post("/purchases/holds/:id/resolve", receive, asyncHandler(c.resolveHold));

  router.post("/purchases/requests/table", view, asyncHandler(c.requestTable));
  router.post("/purchases/requests/generate-weekly", create, asyncHandler(c.generateWeekly));
  router.post("/purchases/requests/generate-low-stock", create, asyncHandler(c.generateLowStock));
  router.get("/purchases/requests/:id", view, asyncHandler(c.getRequest));
  router.post("/purchases/requests/:id/convert", create, asyncHandler(c.convertRequest));
  router.post("/purchases/requests/:id/dismiss", create, asyncHandler(c.dismissRequest));

  router.post("/purchases", create, asyncHandler(c.createOrder));
  router.get("/purchases/:id", view, asyncHandler(c.getOrder));
  router.patch("/purchases/:id", create, asyncHandler(c.updateOrder));
  router.post("/purchases/:id/approve", approve, asyncHandler(c.approveOrder));
  router.post("/purchases/:id/cancel", requiresAnyPermission(["hotel_purchase.create", "hotel_purchase.approve"]), asyncHandler(c.cancelOrder));
  router.post("/purchases/:id/close", approve, asyncHandler(c.closeOrder));
  router.post("/purchases/:id/receipts", receive, asyncHandler(c.receive));

  return router;
};
