import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import * as ctrl from "./ticket.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.delete("/:id", asyncHandler(ctrl.remove));
router.post("/:id/comments", asyncHandler(ctrl.addComment));

export default router;
