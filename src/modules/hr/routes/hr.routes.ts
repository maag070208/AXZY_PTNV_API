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
    summary: "Tabla server-side de personal (GERENTE/JEFE_DE_AREA/EMPLEADO) — ADMIN/RECURSOS_HUMANOS",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Página de personal", content: { "application/json": { schema: PersonalTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/document-types",
    tags: ["Personal"],
    summary: "Catálogo de tipos de documento",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: {
      200: { description: "Lista de tipos de documento", content: { "application/json": { schema: DocumentTypeSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/document-types",
    tags: ["Personal"],
    summary: "Crear tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DocumentTypeCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: DocumentTypeSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/document-types/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DocumentTypeUpdateDto } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: DocumentTypeSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/document-types/{id}",
    tags: ["Personal"],
    summary: "Eliminar tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Tiene documentos asociados" } },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/genders",
    tags: ["Personal"],
    summary: "Catálogo de géneros (soporta includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Lista de géneros", content: { "application/json": { schema: GenderSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/genders",
    tags: ["Personal"],
    summary: "Crear género (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: GenderCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: GenderSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/genders/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar género (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: GenderUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: GenderSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/genders/{id}",
    tags: ["Personal"],
    summary: "Eliminar género (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Género en uso" } },
  });

  registerPath({
    method: "get",
    path: "/hr/catalogs/blood-types",
    tags: ["Personal"],
    summary: "Catálogo de tipos de sangre (soporta includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Lista de tipos de sangre", content: { "application/json": { schema: BloodTypeSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/catalogs/blood-types",
    tags: ["Personal"],
    summary: "Crear tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: BloodTypeCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: BloodTypeSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/catalogs/blood-types/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: BloodTypeUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: BloodTypeSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/catalogs/blood-types/{id}",
    tags: ["Personal"],
    summary: "Eliminar tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Tipo en uso" } },
  });

  registerPath({
    method: "get",
    path: "/hr/stats",
    tags: ["Personal"],
    summary: "Resumen de estadísticas del personal (totales, activos, roles)",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Estadísticas", content: { "application/json": { schema: PersonalStatsSchema } } } },
  });

  registerPath({
    method: "get",
    path: "/hr/{id}",
    tags: ["Personal"],
    summary: "Expediente completo de un empleado (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Expediente", content: { "application/json": { schema: PersonalProfileSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/hr/{id}/profile",
    tags: ["Personal"],
    summary: "Actualizar expediente (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: PersonalProfileUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "put",
    path: "/hr/{id}/discounts",
    tags: ["Personal"],
    summary: "Reemplazar descuentos (INFONAVIT/IMSS/DEUDOR_ALIMENTICIO) — ADMIN/RECURSOS_HUMANOS",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: EmployeeDiscountsSetDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/disciplinary-reports/query",
    tags: ["Personal"],
    summary: "Tabla server-side de cartas/actas administrativas (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DisciplinaryReportQueryListSchema } } } },
    responses: {
      200: { description: "Página de actas", content: { "application/json": { schema: DisciplinaryReportTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/disciplinary-reports/employee/{id}",
    tags: ["Personal"],
    summary: "Historial de actas administrativas de un empleado",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Lista de actas", content: { "application/json": { schema: DisciplinaryReportSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/hr/disciplinary-reports",
    tags: ["Personal"],
    summary: "Crear carta/acta administrativa (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DisciplinaryReportCreateDto } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: DisciplinaryReportSchema } } },
      404: { description: "Empleado no encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/hr/disciplinary-reports/{id}",
    tags: ["Personal"],
    summary: "Obtener una acta administrativa por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Acta", content: { "application/json": { schema: DisciplinaryReportSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/hr/disciplinary-reports/{id}",
    tags: ["Personal"],
    summary: "Eliminar una acta administrativa",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Eliminada" }, 404: { description: "No encontrada" } },
  });

  registerPath({
    method: "get",
    path: "/hr/{id}/documents",
    tags: ["Personal"],
    summary: "Listar documentos subidos de un empleado",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Lista de documentos", content: { "application/json": { schema: EmployeeDocumentSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/hr/{id}/documents",
    tags: ["Personal"],
    summary: "Subir un documento (multipart: file, tipoDocumentoId)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 201: { description: "Subido", content: { "application/json": { schema: EmployeeDocumentSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/hr/{id}/documents/{docId}",
    tags: ["Personal"],
    summary: "Eliminar un documento subido",
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
