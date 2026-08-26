import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import * as ctrl from "./audit.controller";
import { authenticate } from "@core/middlewares/auth.middleware";

const router = Router();

router.get("/", authenticate, ctrl.list);
router.get("/:id", authenticate, ctrl.getOne);

export default router;
