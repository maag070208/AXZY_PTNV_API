import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./user.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();

router.use(authenticate);

// USER y ADMIN pueden listar EMPLEADO (para selector de firmas)
router.get("/empleados", asyncHandler(ctrl.listEmpleados));
router.post("/query", asyncHandler(ctrl.table));

router.use(authorize(["ADMIN"]));

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getById));
router.get("/:id/history", asyncHandler(ctrl.history));
router.post("/", asyncHandler(ctrl.create));
router.post("/import", upload.single("file"), asyncHandler(ctrl.importUsers));
router.put("/:id", asyncHandler(ctrl.update));
router.put("/:id/password", asyncHandler(ctrl.changePassword));
router.delete("/:id", asyncHandler(ctrl.remove));

export default router;