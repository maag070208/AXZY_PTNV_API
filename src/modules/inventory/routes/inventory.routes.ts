import { Router } from "express";
import multer from "multer";
import {
  authenticate,
  requiresAnyPermission,
  requiresPermission,
} from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { INVENTORY_READ_PERMISSIONS, LOAN_READ_PERMISSIONS } from "@core/permissions";
import type { InventoryController } from "../controllers/inventory.controller";

export const createInventoryRouter = (controller: InventoryController): Router => {
  const router = Router();
  router.use(authenticate);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const INVENTORY_READ = INVENTORY_READ_PERMISSIONS;
  const LOAN_READ = LOAN_READ_PERMISSIONS;

  // Auditoría de consistencia (préstamos, unidades y kardex)
  router.get("/audit", requiresPermission("inventory.audit"), asyncHandler(controller.audit));

  // Tipos de dispositivo
  router.get("/device-types", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.listTypes));
  router.post("/device-types", requiresPermission("catalogs.manage"), asyncHandler(controller.createType));
  router.put("/device-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateType));
  router.delete("/device-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.deleteType));

  // Dispositivos
  router.get("/devices", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.listDevices));
  router.post("/devices", requiresPermission("devices.create"), asyncHandler(controller.createDevice));

  // Carga masiva por Excel (antes de `/devices/:id` para que la ruta literal no
  // la capture un id). Requiere `devices.create`: es un alta de dispositivos.
  router.get(
    "/devices/import/template",
    requiresAnyPermission(INVENTORY_READ),
    asyncHandler(controller.deviceImportTemplate)
  );
  router.post(
    "/devices/import/preview",
    requiresPermission("devices.create"),
    upload.single("file"),
    asyncHandler(controller.previewDeviceImport)
  );
  router.post(
    "/devices/import",
    requiresPermission("devices.create"),
    upload.single("file"),
    asyncHandler(controller.importDevices)
  );

  router.get("/devices/:id", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.getDevice));
  router.put("/devices/:id", requiresPermission("devices.edit"), asyncHandler(controller.updateDevice));
  router.delete("/devices/:id", requiresPermission("devices.delete"), asyncHandler(controller.deleteDevice));
  router.get("/devices/:id/stock", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.stock));
  router.get("/devices/:id/units", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.units));
  router.get("/devices/:id/ledger", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.stockLedger));
  router.get("/units", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.searchUnits));
  router.get("/units/:id/history", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.unitHistory));
  router.put("/units/:id", requiresPermission("devices.edit"), asyncHandler(controller.updateUnit));

  // Movimientos
  router.get("/movements", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.listMovements));
  router.get("/movements/:id", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.getMovement));
  router.post("/movements", requiresPermission("devices.edit"), asyncHandler(controller.registerMovement));
  router.post("/movements/:id/revert", requiresPermission("devices.edit"), asyncHandler(controller.revert));

  // Préstamos
  router.get("/loans", requiresAnyPermission(LOAN_READ), asyncHandler(controller.listLoans));
  router.get("/loans/:id", requiresAnyPermission(LOAN_READ), asyncHandler(controller.getLoan));
  router.post("/loans", requiresPermission("loans.create"), asyncHandler(controller.createLoan));
  router.put("/loans/:id", requiresPermission("loans.edit"), asyncHandler(controller.updateLoan));
  router.post("/loans/:id/cancel", requiresPermission("loans.delete"), asyncHandler(controller.cancelLoan));

  // Devoluciones
  router.get("/returns", requiresAnyPermission(LOAN_READ), asyncHandler(controller.listReturns));
  router.post("/returns", requiresPermission("loans.edit"), asyncHandler(controller.createLoanReturn));

  // Dashboard
  router.get("/dashboard", requiresAnyPermission(INVENTORY_READ), asyncHandler(controller.dashboard));

  return router;
};