import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import type { UserRole } from "@core/utils/security";
import {
  ChecadaQuerySchema,
  ChecadaTableResponseSchema,
  ChecadorEmpleadoSchema,
  ChecadorEmpleadosQuerySchema,
  ChecadorEmpleadosResponseSchema,
  ChecadorImportDto,
  ChecadorImportacionSchema,
  ChecadorReportExportResponseSchema,
  ChecadorReportQuerySchema,
  ChecadorReportResponseSchema,
  ChecadorStatusSchema,
  ChecadorVinculoDto,
} from "../models/dto/checador.dto";
import type { ChecadorController } from "../controllers/checador.controller";

// Importar solo LEE del reloj y lo que guarda es idempotente: quien consulta
// las checadas también puede traerlas cuando las necesite.
const READ_ROLES: UserRole[] = ["ADMIN", "GERENTE", "RECURSOS_HUMANOS", "JEFE_DE_AREA"];
// Vincular toca a qué persona se le cuentan las checadas: solo ADMIN y RH.
const LINK_ROLES: UserRole[] = ["ADMIN", "RECURSOS_HUMANOS"];

const bearer = [{ bearerAuth: [] }];

export const createChecadorRouter = (controller: ChecadorController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/checador/query",
    tags: ["Checador"],
    summary: "Tabla server-side de checadas del reloj (filtros: q, numeroEmpleado, metodo, desde, hasta, tz)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadaQuerySchema } } } },
    responses: {
      200: { description: "Página de checadas", content: { "application/json": { schema: ChecadaTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/checador/status",
    tags: ["Checador"],
    summary: "Estado de la sincronización con el reloj",
    security: bearer,
    responses: {
      200: { description: "Estado", content: { "application/json": { schema: ChecadorStatusSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/import",
    tags: ["Checador"],
    summary:
      "Importar del reloj las checadas de un rango de días (solo lee del reloj; corre en segundo plano, avance en /checador/status)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadorImportDto } } } },
    responses: {
      202: { description: "Importación iniciada", content: { "application/json": { schema: ChecadorImportacionSchema } } },
      400: { description: "Fechas o zona horaria inválidas" },
      409: { description: "Ya hay una importación en curso" },
      503: { description: "Checador sin configurar (CHECADOR_URL)" },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/report",
    tags: ["Checador"],
    summary:
      "Entradas/salidas a partir de las checadas del reloj (mismo contrato que /access/report; relación por número del reloj)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadorReportQuerySchema } } } },
    responses: {
      200: { description: "Página de sesiones + resumen", content: { "application/json": { schema: ChecadorReportResponseSchema } } },
      400: { description: "period/date/tz inválidos" },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/report/export",
    tags: ["Checador"],
    summary: "Mismo cálculo que /checador/report, con TODAS las sesiones (CSV/PDF)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadorReportQuerySchema } } } },
    responses: {
      200: { description: "Todas las sesiones + resumen", content: { "application/json": { schema: ChecadorReportExportResponseSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/empleados/query",
    tags: ["Checador"],
    summary: "Empleados del reloj y su vínculo con usuarios (filtros: q, estado VINCULADO/SIN_VINCULAR/SUGERIDO)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadorEmpleadosQuerySchema } } } },
    responses: {
      200: { description: "Página + resumen", content: { "application/json": { schema: ChecadorEmpleadosResponseSchema } } },
    },
  });

  registerPath({
    method: "put",
    path: "/checador/empleados/{numero}",
    tags: ["Checador"],
    summary: "Vincular un número del reloj con un usuario (ADMIN/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "numero", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: ChecadorVinculoDto } } } },
    responses: {
      200: { description: "Vinculado", content: { "application/json": { schema: ChecadorEmpleadoSchema } } },
      404: { description: "Número sin checadas o usuario inexistente" },
    },
  });

  registerPath({
    method: "delete",
    path: "/checador/empleados/{numero}",
    tags: ["Checador"],
    summary: "Quitar el vínculo de un número del reloj (ADMIN/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "numero", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Desvinculado" }, 404: { description: "No estaba vinculado" } },
  });

  registerPath({
    method: "post",
    path: "/checador/empleados/vincular-sugeridos",
    tags: ["Checador"],
    summary: "Vincular de un jalón las sugerencias de confianza ALTA (nombre y número coinciden)",
    security: bearer,
    responses: { 200: { description: "{ vinculados }" } },
  });

  router.use(authenticate);

  router.post("/query", authorize(READ_ROLES), asyncHandler(controller.table));
  router.get("/status", authorize(READ_ROLES), asyncHandler(controller.status));
  router.post("/import", authorize(READ_ROLES), asyncHandler(controller.importar));

  router.post("/report", authorize(READ_ROLES), asyncHandler(controller.reporte));
  router.post("/report/export", authorize(READ_ROLES), asyncHandler(controller.reporteExport));

  router.post("/empleados/query", authorize(READ_ROLES), asyncHandler(controller.empleadosTable));
  router.post("/empleados/vincular-sugeridos", authorize(LINK_ROLES), asyncHandler(controller.vincularSugeridos));
  router.put("/empleados/:numero", authorize(LINK_ROLES), asyncHandler(controller.vincular));
  router.delete("/empleados/:numero", authorize(LINK_ROLES), asyncHandler(controller.desvincular));

  return router;
};
