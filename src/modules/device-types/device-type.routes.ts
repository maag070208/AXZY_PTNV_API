import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./device-type.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.get("/", authenticate, asyncHandler(ctrl.list));
router.post("/query", authenticate, asyncHandler(ctrl.table));
router.get("/:id/peek", authenticate, asyncHandler(ctrl.peek));
router.get("/:id", authenticate, asyncHandler(ctrl.getOne));

router.post("/", authenticate, authorize(["ADMIN"]), asyncHandler(ctrl.create));
router.put("/:id", authenticate, authorize(["ADMIN"]), asyncHandler(ctrl.update));
router.delete("/:id", authenticate, authorize(["ADMIN"]), asyncHandler(ctrl.remove));

export default router;