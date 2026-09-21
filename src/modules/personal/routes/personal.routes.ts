import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import type { UserRole } from "@core/utils/security";
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
  TipoDocumentoSchema,
  TipoDocumentoCreateDto,
  TipoDocumentoUpdateDto,
  GeneroSchema,
  GeneroCreateDto,
  GeneroUpdateDto,
  TipoSangreSchema,
  TipoSangreCreateDto,
  TipoSangreUpdateDto,
} from "../models/dto/personal.dto";
import {
  ActaAdministrativaSchema,
  ActaAdministrativaCreateDto,
  ActaTableResponseSchema,
  ActaQueryListSchema,
} from "../models/dto/acta.dto";
import type { PersonalController } from "../controllers/personal.controller";

const HR_ROLES: UserRole[] = ["ADMIN", "RECURSOS_HUMANOS"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const createPersonalRouter = (controller: PersonalController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/personal/query",
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
    path: "/personal/catalogos/tipos-documento",
    tags: ["Personal"],
    summary: "Catálogo de tipos de documento",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: {
      200: { description: "Lista de tipos de documento", content: { "application/json": { schema: TipoDocumentoSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/personal/catalogos/tipos-documento",
    tags: ["Personal"],
    summary: "Crear tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TipoDocumentoCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: TipoDocumentoSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/personal/catalogos/tipos-documento/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TipoDocumentoUpdateDto } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: TipoDocumentoSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/personal/catalogos/tipos-documento/{id}",
    tags: ["Personal"],
    summary: "Eliminar tipo de documento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Tiene documentos asociados" } },
  });

  registerPath({
    method: "get",
    path: "/personal/catalogos/generos",
    tags: ["Personal"],
    summary: "Catálogo de géneros (soporta includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Lista de géneros", content: { "application/json": { schema: GeneroSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/personal/catalogos/generos",
    tags: ["Personal"],
    summary: "Crear género (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: GeneroCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: GeneroSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/personal/catalogos/generos/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar género (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: GeneroUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: GeneroSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/personal/catalogos/generos/{id}",
    tags: ["Personal"],
    summary: "Eliminar género (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Género en uso" } },
  });

  registerPath({
    method: "get",
    path: "/personal/catalogos/tipos-sangre",
    tags: ["Personal"],
    summary: "Catálogo de tipos de sangre (soporta includeInactive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Lista de tipos de sangre", content: { "application/json": { schema: TipoSangreSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/personal/catalogos/tipos-sangre",
    tags: ["Personal"],
    summary: "Crear tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TipoSangreCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: TipoSangreSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/personal/catalogos/tipos-sangre/{id}",
    tags: ["Personal"],
    summary: "Renombrar/activar/desactivar tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TipoSangreUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: TipoSangreSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/personal/catalogos/tipos-sangre/{id}",
    tags: ["Personal"],
    summary: "Eliminar tipo de sangre (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Soft/físico" }, 400: { description: "Tipo en uso" } },
  });

  registerPath({
    method: "get",
    path: "/personal/stats",
    tags: ["Personal"],
    summary: "Resumen de estadísticas del personal (totales, activos, roles)",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Estadísticas", content: { "application/json": { schema: PersonalStatsSchema } } } },
  });

  registerPath({
    method: "get",
    path: "/personal/{id}",
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
    path: "/personal/{id}/perfil",
    tags: ["Personal"],
    summary: "Actualizar expediente (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: PersonalProfileUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "put",
    path: "/personal/{id}/descuentos",
    tags: ["Personal"],
    summary: "Reemplazar descuentos (INFONAVIT/IMSS/DEUDOR_ALIMENTICIO) — ADMIN/RECURSOS_HUMANOS",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: EmployeeDiscountsSetDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: PersonalProfileSchema } } } },
  });

  registerPath({
    method: "post",
    path: "/personal/actas/query",
    tags: ["Personal"],
    summary: "Tabla server-side de cartas/actas administrativas (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: ActaQueryListSchema } } } },
    responses: {
      200: { description: "Página de actas", content: { "application/json": { schema: ActaTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/personal/actas/empleado/{id}",
    tags: ["Personal"],
    summary: "Historial de actas administrativas de un empleado",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Lista de actas", content: { "application/json": { schema: ActaAdministrativaSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/personal/actas",
    tags: ["Personal"],
    summary: "Crear carta/acta administrativa (ADMIN/RECURSOS_HUMANOS)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: ActaAdministrativaCreateDto } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: ActaAdministrativaSchema } } },
      404: { description: "Empleado no encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/personal/actas/{id}",
    tags: ["Personal"],
    summary: "Obtener una acta administrativa por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Acta", content: { "application/json": { schema: ActaAdministrativaSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/personal/actas/{id}",
    tags: ["Personal"],
    summary: "Eliminar una acta administrativa",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Eliminada" }, 404: { description: "No encontrada" } },
  });

  registerPath({
    method: "get",
    path: "/personal/{id}/documentos",
    tags: ["Personal"],
    summary: "Listar documentos subidos de un empleado",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Lista de documentos", content: { "application/json": { schema: EmployeeDocumentSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/personal/{id}/documentos",
    tags: ["Personal"],
    summary: "Subir un documento (multipart: file, tipoDocumentoId)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 201: { description: "Subido", content: { "application/json": { schema: EmployeeDocumentSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/personal/{id}/documentos/{docId}",
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
  router.get("/catalogos/tipos-documento", authorize(HR_ROLES), asyncHandler(controller.listDocumentTypes));
  router.post("/catalogos/tipos-documento", authorize(["ADMIN"]), asyncHandler(controller.createDocumentType));
  router.patch("/catalogos/tipos-documento/:id", authorize(["ADMIN"]), asyncHandler(controller.updateDocumentType));
  router.delete("/catalogos/tipos-documento/:id", authorize(["ADMIN"]), asyncHandler(controller.removeDocumentType));
  router.get("/catalogos/generos", authorize(HR_ROLES), asyncHandler(controller.listGeneros));
  router.post("/catalogos/generos", authorize(["ADMIN"]), asyncHandler(controller.createGenero));
  router.patch("/catalogos/generos/:id", authorize(["ADMIN"]), asyncHandler(controller.updateGenero));
  router.delete("/catalogos/generos/:id", authorize(["ADMIN"]), asyncHandler(controller.removeGenero));
  router.get("/catalogos/tipos-sangre", authorize(HR_ROLES), asyncHandler(controller.listTiposSangre));
  router.post("/catalogos/tipos-sangre", authorize(["ADMIN"]), asyncHandler(controller.createTipoSangre));
  router.patch("/catalogos/tipos-sangre/:id", authorize(["ADMIN"]), asyncHandler(controller.updateTipoSangre));
  router.delete("/catalogos/tipos-sangre/:id", authorize(["ADMIN"]), asyncHandler(controller.removeTipoSangre));

  router.post("/query", authorize(HR_ROLES), asyncHandler(controller.table));
  router.get("/stats", authorize(HR_ROLES), asyncHandler(controller.stats));

  // Cartas/actas administrativas. Deben ir antes de "/:id".
  router.post("/actas/query", authorize(HR_ROLES), asyncHandler(controller.actasTable));
  router.get("/actas/empleado/:id", authorize(HR_ROLES), asyncHandler(controller.actasByEmployee));
  router.post("/actas", authorize(HR_ROLES), asyncHandler(controller.actasCreate));
  router.get("/actas/:id", authorize(HR_ROLES), asyncHandler(controller.actasGetOne));
  router.delete("/actas/:id", authorize(HR_ROLES), asyncHandler(controller.actasRemove));

  router.get("/:id", authorize(HR_ROLES), asyncHandler(controller.getOne));
  router.patch("/:id/perfil", authorize(HR_ROLES), asyncHandler(controller.updateProfile));
  router.put("/:id/descuentos", authorize(HR_ROLES), asyncHandler(controller.setDiscounts));

  router.post("/:id/foto", authorize(HR_ROLES), upload.single("file"), asyncHandler(controller.uploadPhoto));

  router.get("/:id/documentos", authorize(HR_ROLES), asyncHandler(controller.listDocuments));
  router.post("/:id/documentos", authorize(HR_ROLES), upload.single("file"), asyncHandler(controller.uploadDocument));
  router.delete("/:id/documentos/:docId", authorize(HR_ROLES), asyncHandler(controller.removeDocument));
  router.get("/:id/documentos/:docId/descargar", authorize(HR_ROLES), asyncHandler(controller.downloadDocument));

  return router;
};
