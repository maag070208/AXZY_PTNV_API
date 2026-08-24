import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import * as ctrl from "./notification.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.get("/unread-count", asyncHandler(ctrl.unreadCount));
router.post("/read-all", asyncHandler(ctrl.markAllRead));
router.post("/:id/read", asyncHandler(ctrl.markRead));
router.delete("/:id", asyncHandler(ctrl.remove));

export default router;
