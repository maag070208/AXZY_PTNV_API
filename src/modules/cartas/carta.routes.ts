import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import * as ctrl from "./carta.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/consecutivo", asyncHandler(ctrl.getConsecutivo));
router.get("/consecutivo/peek", asyncHandler(ctrl.peek));
router.post("/consecutivo/reset", asyncHandler(ctrl.resetConsecutivoCtrl));

router.post("/generate", asyncHandler(ctrl.generateCartas));

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.delete("/:id", asyncHandler(ctrl.remove));

router.post("/:id/return", asyncHandler(ctrl.returnCarta));
router.delete("/:id/return", asyncHandler(ctrl.undoReturn));

export default router;