import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import * as ctrl from "./report.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.report));
router.post("/query", asyncHandler(ctrl.table));
router.get("/.csv", asyncHandler(ctrl.csv));

export default router;