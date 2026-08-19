import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./department.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/:id", asyncHandler(ctrl.getOne));

router.post("/", authorize(["ADMIN"]), asyncHandler(ctrl.create));
router.put("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.update));
router.delete("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.remove));

router.post(
  "/:id/subareas",
  authorize(["ADMIN"]),
  asyncHandler(ctrl.addSubarea)
);
router.delete(
  "/subareas/:id",
  authorize(["ADMIN"]),
  asyncHandler(ctrl.removeSubarea)
);

export default router;