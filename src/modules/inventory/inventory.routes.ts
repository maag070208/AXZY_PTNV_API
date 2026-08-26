import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
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
router.post("/movements", registerMovementCtrl);
router.get("/summary", getInventorySummaryCtrl);

export default router;
