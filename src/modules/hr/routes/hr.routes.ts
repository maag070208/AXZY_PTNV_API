import { Router } from "express";
import multer from "multer";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  PersonalProfileSchema,
  PersonalProfileUpdateDto,
  PersonalStatsSchema,
  PersonalTableResponseSchema,
  EmployeeDiscountsSetDto,
  EmployeeDocumentSchema,
  DocumentTypeSchema,
  DocumentTypeCreateDto,
  DocumentTypeUpdateDto,
  GenderSchema,
  GenderCreateDto,
  GenderUpdateDto,
  BloodTypeSchema,
  BloodTypeCreateDto,
  BloodTypeUpdateDto,
} from "../models/dto/hr.dto";
import {
  DisciplinaryReportSchema,
  DisciplinaryReportCreateDto,
  DisciplinaryReportTableResponseSchema,
  DisciplinaryReportQueryListSchema,
} from "../models/dto/disciplinary-report.dto";
import type { PersonalController } from "../controllers/hr.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const createPersonalRouter = (controller: PersonalController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/hr/query",
    tags: ["Personal"],
    summary: "Server-side table of staff (MANAGER/AREA_HEAD/EMPLOYEE) — ADMIN/HUMAN_RESOURCES",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Page of staff", content: { "application/json": { schema: PersonalTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/document-types",
    tags: ["Personal"],
    summary: "Document type catalog",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: {
      200: { description: "Document type list", content: { "application/json": { schema: DocumentTypeSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/document-types",
    tags: ["Personal"],
    summary: "Create document type (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DocumentTypeCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: DocumentTypeSchema } } },
      409: { description: "Duplicate name" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/document-types/{id}",
    tags: ["Personal"],
    summary: "Rename/activate/deactivate document type (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DocumentTypeUpdateDto } } } },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: DocumentTypeSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/document-types/{id}",
    tags: ["Personal"],
    summary: "Delete document type (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/hard" }, 400: { description: "Has associated documents" } },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/genders",
    tags: ["Personal"],
    summary: "Gender catalog (supports includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Gender list", content: { "application/json": { schema: GenderSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/genders",
    tags: ["Personal"],
    summary: "Create gender (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: GenderCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: GenderSchema } } },
      409: { description: "Duplicate name" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/genders/{id}",
    tags: ["Personal"],
    summary: "Rename/activate/deactivate gender (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: GenderUpdateDto } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: GenderSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/genders/{id}",
    tags: ["Personal"],
    summary: "Delete gender (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/hard" }, 400: { description: "Gender in use" } },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/blood-types",
    tags: ["Personal"],
    summary: "Blood type catalog (supports includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Blood type list", content: { "application/json": { schema: BloodTypeSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/blood-types",
    tags: ["Personal"],
    summary: "Create blood type (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: BloodTypeCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: BloodTypeSchema } } },
      409: { description: "Duplicate name" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/blood-types/{id}",
    tags: ["Personal"],
    summary: "Rename/activate/deactivate blood type (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: BloodTypeUpdateDto } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: BloodTypeSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/blood-types/{id}",
    tags: ["Personal"],
    summary: "Delete blood type (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/hard" }, 400: { description: "Type in use" } },
  });

  registerPath({
    method: "get",
    path: "/hr/stats",
    tags: ["Personal"],
    summary: "Staff statistics summary (totals, active, roles)",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Statistics", content: { "application/json": { schema: PersonalStatsSchema } } } },
  });

  registerPath({
    method: "get",
    path: "/hr/{id}",
    tags: ["Personal"],
    summary: "Full employee record (ADMIN/HUMAN_RESOURCES)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Employee record", content: { "application/json": { schema: PersonalProfileSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/{id}/profile",
    tags: ["Personal"],
    summary: "Update employee record (ADMIN/HUMAN_RESOURCES)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: PersonalProfileUpdateDto } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "put",
    path: "/hr/{id}/discounts",
    tags: ["Personal"],
    summary: "Replace discounts (INFONAVIT/IMSS/CHILD_SUPPORT) — ADMIN/HUMAN_RESOURCES",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: EmployeeDiscountsSetDto } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/disciplinary-reports/query",
    tags: ["Personal"],
    summary: "Server-side table of disciplinary reports (ADMIN/HUMAN_RESOURCES)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DisciplinaryReportQueryListSchema } } } },
    responses: {
      200: { description: "Page of disciplinary reports", content: { "application/json": { schema: DisciplinaryReportTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/disciplinary-reports/employee/{id}",
    tags: ["Personal"],
    summary: "Disciplinary report history of an employee",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Disciplinary report list", content: { "application/json": { schema: DisciplinaryReportSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/hr/disciplinary-reports",
    tags: ["Personal"],
    summary: "Create disciplinary report (ADMIN/HUMAN_RESOURCES)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DisciplinaryReportCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: DisciplinaryReportSchema } } },
      404: { description: "Employee not found" },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/disciplinary-reports/{id}",
    tags: ["Personal"],
    summary: "Get a disciplinary report by id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Disciplinary report", content: { "application/json": { schema: DisciplinaryReportSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/hr/disciplinary-reports/{id}",
    tags: ["Personal"],
    summary: "Delete a disciplinary report",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Eliminada" }, 404: { description: "No encontrada" } },
  });

  registerPath({
    method: "get",
    path: "/hr/{id}/documents",
    tags: ["Personal"],
    summary: "List an employee's uploaded documents",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Document list", content: { "application/json": { schema: EmployeeDocumentSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/{id}/documents",
    tags: ["Personal"],
    summary: "Upload a document (multipart: file, documentTypeId)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 201: { description: "Subido", content: { "application/json": { schema: EmployeeDocumentSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/{id}/documents/{docId}",
    tags: ["Personal"],
    summary: "Delete an uploaded document",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "docId", required: true, schema: { type: "string" } },
    ],
    responses: { 200: { description: "Eliminado" } },
  });

  router.use(authenticate);

  // Catálogos primero: deben registrarse antes de "/:id" para no colisionar.
  router.get("/catalogs/document-types", requiresPermission("hr.records"), asyncHandler(controller.listDocumentTypes));
  router.post("/catalogs/document-types", requiresPermission("catalogs.manage"), asyncHandler(controller.createDocumentType));
  router.patch("/catalogs/document-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateDocumentType));
  router.delete("/catalogs/document-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.removeDocumentType));
  router.get("/catalogs/genders", requiresPermission("hr.records"), asyncHandler(controller.listGenders));
  router.post("/catalogs/genders", requiresPermission("catalogs.manage"), asyncHandler(controller.createGender));
  router.patch("/catalogs/genders/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateGender));
  router.delete("/catalogs/genders/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.removeGender));
  router.get("/catalogs/blood-types", requiresPermission("hr.records"), asyncHandler(controller.listBloodTypes));
  router.post("/catalogs/blood-types", requiresPermission("catalogs.manage"), asyncHandler(controller.createBloodType));
  router.patch("/catalogs/blood-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateBloodType));
  router.delete("/catalogs/blood-types/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.removeBloodType));

  router.post("/query", requiresPermission("hr.records"), asyncHandler(controller.table));
  router.get("/stats", requiresPermission("hr.records"), asyncHandler(controller.stats));

  // Cartas/actas administrativas. Deben ir antes de "/:id".
  router.post("/disciplinary-reports/query", requiresPermission("hr.disciplinary_reports"), asyncHandler(controller.disciplinaryReportsTable));
  router.get("/disciplinary-reports/employee/:id", requiresPermission("hr.disciplinary_reports"), asyncHandler(controller.disciplinaryReportsByEmployee));
  router.post("/disciplinary-reports", requiresPermission("hr.disciplinary_reports"), asyncHandler(controller.disciplinaryReportsCreate));
  router.get("/disciplinary-reports/:id", requiresPermission("hr.disciplinary_reports"), asyncHandler(controller.disciplinaryReportsGetOne));
  router.delete("/disciplinary-reports/:id", requiresPermission("hr.disciplinary_reports"), asyncHandler(controller.disciplinaryReportsRemove));

  router.get("/:id", requiresPermission("hr.records"), asyncHandler(controller.getOne));
  router.patch("/:id/profile", requiresPermission("hr.records"), asyncHandler(controller.updateProfile));
  router.put("/:id/discounts", requiresPermission("hr.records"), asyncHandler(controller.setDiscounts));

  router.post("/:id/photo", requiresPermission("hr.records"), upload.single("file"), asyncHandler(controller.uploadPhoto));

  router.get("/:id/documents", requiresPermission("hr.records"), asyncHandler(controller.listDocuments));
  router.post("/:id/documents", requiresPermission("hr.records"), upload.single("file"), asyncHandler(controller.uploadDocument));
  router.delete("/:id/documents/:docId", requiresPermission("hr.records"), asyncHandler(controller.removeDocument));
  router.get("/:id/documents/:docId/download", requiresPermission("hr.records"), asyncHandler(controller.downloadDocument));
  router.post("/:id/notify-registration", requiresPermission("hr.records"), asyncHandler(controller.notifyRegistration));

  return router;
};
