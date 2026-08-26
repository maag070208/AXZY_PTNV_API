import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
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
router.post("/", createLocationCtrl);
router.put("/:id", updateLocationCtrl);
router.delete("/:id", deleteLocationCtrl);

export default router;
