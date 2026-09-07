import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./device.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/summary", asyncHandler(ctrl.summary));
router.get("/lotes/:loteId", asyncHandler(ctrl.getLote));
router.get("/:id", asyncHandler(ctrl.getOne));
router.get("/:id/history", asyncHandler(ctrl.getHistory));
router.post("/:id/history", asyncHandler(ctrl.addHistory));

router.post("/", authorize(["ADMIN"]), asyncHandler(ctrl.create));
router.post("/batch", authorize(["ADMIN"]), asyncHandler(ctrl.createBatch));
router.put("/lotes/:loteId", authorize(["ADMIN"]), asyncHandler(ctrl.updateLote));
router.put("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.update));
router.delete("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.remove));

export default router;
