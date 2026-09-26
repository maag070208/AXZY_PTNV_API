import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import type { InventoryController } from "../controllers/inventory.controller";

export const createInventoryRouter = (controller: InventoryController): Router => {
  const router = Router();
  router.use(authenticate);

  // Tipos de dispositivo
  router.get("/device-types", asyncHandler(controller.listTypes));
  router.post("/device-types", requiresPermission("catalogs.manage"), asyncHandler(controller.createType));
  router.put("/device-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateType));
  router.delete("/device-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.deleteType));

  // Dispositivos
  router.get("/devices", asyncHandler(controller.listDevices));
  router.post("/devices", requiresPermission("devices.create"), asyncHandler(controller.createDevice));
  router.get("/devices/:id", asyncHandler(controller.getDevice));
  router.put("/devices/:id", requiresPermission("devices.edit"), asyncHandler(controller.updateDevice));
  router.delete("/devices/:id", requiresPermission("devices.delete"), asyncHandler(controller.deleteDevice));
  router.get("/devices/:id/stock", asyncHandler(controller.stock));
  router.get("/devices/:id/units", asyncHandler(controller.units));
  router.get("/devices/:id/ledger", asyncHandler(controller.stockLedger));
  router.get("/units", asyncHandler(controller.searchUnits));
  router.put("/units/:id", requiresPermission("devices.edit"), asyncHandler(controller.updateUnit));

  // Movimientos
  router.get("/movements", asyncHandler(controller.listMovements));
  router.get("/movements/:id", asyncHandler(controller.getMovement));
  router.post("/movements", requiresPermission("devices.edit"), asyncHandler(controller.registerMovement));
  router.post("/movements/:id/revert", requiresPermission("devices.edit"), asyncHandler(controller.revert));

  // Préstamos
  router.get("/loans", asyncHandler(controller.listLoans));
  router.get("/loans/:id", asyncHandler(controller.getLoan));
  router.post("/loans", requiresPermission("loans.create"), asyncHandler(controller.createLoan));
  router.put("/loans/:id", requiresPermission("loans.edit"), asyncHandler(controller.updateLoan));
  router.post("/loans/:id/cancel", requiresPermission("loans.delete"), asyncHandler(controller.cancelLoan));

  // Devoluciones
  router.get("/returns", asyncHandler(controller.listReturns));
  router.post("/returns", requiresPermission("loans.edit"), asyncHandler(controller.createLoanReturn));

  // Dashboard
  router.get("/dashboard", asyncHandler(controller.dashboard));

  return router;
};