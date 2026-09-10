import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import {
  listMovementsCtrl,
  getKardexCtrl,
  registerMovementCtrl,
  getInventorySummaryCtrl,
} from "./inventory.controller";

const router = Router();

router.use(authenticate);

router.get("/movements", listMovementsCtrl);
router.get("/kardex/:deviceId", getKardexCtrl);
// Registrar movimientos de inventario es una operación operativa de TI, no para cualquier empleado.
router.post("/movements", authorize(["ADMIN", "GERENTE", "JEFE_DE_AREA"]), registerMovementCtrl);
router.get("/summary", getInventorySummaryCtrl);

export default router;
