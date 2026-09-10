import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./material.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/summary", asyncHandler(ctrl.summary));
router.get("/categorias", asyncHandler(ctrl.categorias));
router.get("/:id", asyncHandler(ctrl.getOne));

router.post("/", authorize(["ADMIN"]), asyncHandler(ctrl.create));
router.post(
  "/import/parse",
  authorize(["ADMIN"]),
  upload.single("file"),
  asyncHandler(ctrl.parseImportFile)
);
router.post(
  "/import",
  authorize(["ADMIN"]),
  upload.single("file"),
  asyncHandler(ctrl.importMaterials)
);
router.put("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.update));
router.delete("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.remove));

export default router;
