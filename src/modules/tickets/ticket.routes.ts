import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./ticket.controller";
import { asyncHandler } from "@core/utils/asyncHandler";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.get("/kanban", asyncHandler(ctrl.kanban));
router.post("/query", asyncHandler(ctrl.table));
router.get("/:id/attachments", asyncHandler(ctrl.listTicketAttachments));
router.post("/:id/attachments", upload.single("file"), asyncHandler(ctrl.uploadTicketAttachment));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
// Solo ADMIN puede eliminar tickets, incluso si tienen historial/estado abierto.
router.delete("/:id", authorize(["ADMIN"]), asyncHandler(ctrl.remove));
router.post("/:id/comments", asyncHandler(ctrl.addComment));
router.post("/:id/assignments", asyncHandler(ctrl.addAssignment));
router.put("/:id/assignments/:assignmentId", asyncHandler(ctrl.updateAssignment));
router.delete("/:id/assignments/:assignmentId", asyncHandler(ctrl.removeAssignment));
router.get("/:id/assignments/:assignmentId/attachments", asyncHandler(ctrl.listAssignmentAttachments));
router.post("/:id/assignments/:assignmentId/attachments", upload.single("file"), asyncHandler(ctrl.uploadAssignmentAttachment));
router.post("/:id/assignments/:assignmentId/comments", asyncHandler(ctrl.addAssignmentComment));

export default router;
