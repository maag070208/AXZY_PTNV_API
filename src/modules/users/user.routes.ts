import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./user.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

// USER y ADMIN pueden listar EMPLEADO (para selector de firmas)
router.get("/empleados", asyncHandler(ctrl.listEmpleados));
router.post("/query", asyncHandler(ctrl.table));

router.use(authorize(["ADMIN"]));

router.get("/", asyncHandler(ctrl.list));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.put("/:id/password", asyncHandler(ctrl.changePassword));
router.delete("/:id", asyncHandler(ctrl.remove));

export default router;