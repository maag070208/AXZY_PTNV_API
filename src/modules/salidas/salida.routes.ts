import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import * as ctrl from "./salida.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/suggestions", asyncHandler(ctrl.suggestions));
router.get("/:id", asyncHandler(ctrl.getOne));

router.post("/", asyncHandler(ctrl.create));
router.post("/batch", asyncHandler(ctrl.createBatch));
router.put("/:id", asyncHandler(ctrl.update));
router.delete("/:id", asyncHandler(ctrl.remove));

export default router;
