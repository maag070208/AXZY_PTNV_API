import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelWriteoffController } from "../controllers/writeoff.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

/** Bajas de blancos y estado físico. Mounted by the hotel router under `/linen`. */
export const createHotelWriteoffRouter = (c: HotelWriteoffController): Router => {
  const router = Router();
  const view = requiresPermission("hotel_linen.view");

  router.post("/writeoffs", requiresPermission("hotel_linen.writeoff_request"), upload.array("photos", 10), asyncHandler(c.create));
  router.post("/writeoffs/table", view, asyncHandler(c.table));
  router.get("/writeoffs/weekly", view, asyncHandler(c.weekly));
  router.get("/writeoffs/:id", view, asyncHandler(c.get));
  router.get("/writeoffs/:id/evidence/:evidenceId", view, asyncHandler(c.evidence));
  router.post("/writeoffs/:id/review", requiresPermission("hotel_linen.writeoff_review"), asyncHandler(c.review));
  router.post("/writeoffs/:id/approve", requiresPermission("hotel_linen.writeoff_approve"), asyncHandler(c.approve));
  router.post("/writeoffs/:id/reject", requiresPermission("hotel_linen.writeoff_approve"), asyncHandler(c.reject));

  router.get("/condition", view, asyncHandler(c.condition));

  return router;
};
