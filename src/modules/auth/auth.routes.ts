import { Router } from "express";
import * as ctrl from "./auth.controller";
import { authenticate } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.post("/login", asyncHandler(ctrl.login));
router.get("/me", authenticate, asyncHandler(ctrl.me));

export default router;