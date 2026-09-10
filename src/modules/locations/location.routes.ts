import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import {
  listLocationsCtrl,
  getLocationCtrl,
  createLocationCtrl,
  updateLocationCtrl,
  deleteLocationCtrl,
} from "./location.controller";

const router = Router();

router.use(authenticate);

router.get("/", listLocationsCtrl);
router.get("/:id", getLocationCtrl);
// Catálogo de ubicaciones: el frontend ya restringe estos botones a ADMIN; se iguala aquí.
router.post("/", authorize(["ADMIN"]), createLocationCtrl);
router.put("/:id", authorize(["ADMIN"]), updateLocationCtrl);
router.delete("/:id", authorize(["ADMIN"]), deleteLocationCtrl);

export default router;
