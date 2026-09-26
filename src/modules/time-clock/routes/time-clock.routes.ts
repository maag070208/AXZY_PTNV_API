import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  ChecadaQuerySchema,
  ChecadaTableResponseSchema,
  ChecadorEmpleadoSchema,
  ChecadorEmpleadosQuerySchema,
  ChecadorEmpleadosResponseSchema,
  ChecadorImportDto,
  ChecadorImportacionSchema,
  ChecadorDispositivoSchema,
  ChecadorProgresoSchema,
  ChecadorRelojConfigSchema,
  ChecadorRelojDto,
  ChecadorRelojUpdateDto,
  ChecadorReportExportResponseSchema,
  ChecadorReportQuerySchema,
  ChecadorReportResponseSchema,
  ChecadorStatusSchema,
  ChecadorVinculoDto,
} from "../models/dto/checador.dto";
import type { ChecadorController } from "../controllers/checador.controller";

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
      503: { description: "Sin CHECADOR_USER o sin relojes dados de alta" },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/sync",
    tags: ["Checador"],
    summary:
      "Drena de cada reloj todo lo que falte desde su cursor (solo lee; 202, avance en /checador/status)",
    security: bearer,
    responses: {
      202: { description: "Drenado iniciado", content: { "application/json": { schema: ChecadorProgresoSchema } } },
      409: { description: "Todos los relojes ya están sincronizando" },
      503: { description: "Sin CHECADOR_USER o sin relojes dados de alta" },
    },
  });

  registerPath({
    method: "post",
    path: "/checador/relojes",
    tags: ["Checador"],
    summary:
      "Dar de alta un reloj (ADMIN). Se conecta y lee su identidad (solo lectura) y arranca su sincronización",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ChecadorRelojDto } } } },
    responses: {
      201: { description: "Reloj dado de alta", content: { "application/json": { schema: ChecadorDispositivoSchema } } },
      400: { description: "Dirección inválida" },
      409: { description: "Ese reloj (dirección o serie) ya está dado de alta" },
      502: { description: "El reloj no contesta o rechazó el usuario (CHECADOR_SIN_CONEXION / CHECADOR_CREDENCIALES)" },
      503: { description: "La API no tiene CHECADOR_USER / CHECADOR_PASS" },
    },
  });

  registerPath({
    method: "patch",
    path: "/checador/relojes/{serie}",
    tags: ["Checador"],
    summary:
      "Cambiar el nombre de un reloj o si cuenta para entradas/salidas (ADMIN). Es el registro del sistema: no toca el reloj",
    security: bearer,
    parameters: [{ in: "path", name: "serie", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: ChecadorRelojUpdateDto } } } },
    responses: {
      200: { description: "Reloj actualizado", content: { "application/json": { schema: ChecadorDispositivoSchema } } },
      400: { description: "Sin cambios o nombre vacío" },
      404: { description: "No está dado de alta" },
    },
  });

  registerPath({
    method: "delete",
    path: "/checador/relojes/{serie}",
    tags: ["Checador"],
    summary: "Dar de baja un reloj (ADMIN): deja de sincronizarse; sus checadas y su cursor se quedan",
    security: bearer,
    parameters: [{ in: "path", name: "serie", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "{ dispositivoSerie }" }, 404: { description: "No está dado de alta" } },
  });

  registerPath({
    method: "get",
    path: "/checador/relojes/{serie}/configuracion",
    tags: ["Checador"],
    summary: "Configuración leída en vivo del reloj (ADMIN; solo lectura): identidad, hora y personas",
    security: bearer,
    parameters: [{ in: "path", name: "serie", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Configuración", content: { "application/json": { schema: ChecadorRelojConfigSchema } } },
      404: { description: "No está dado de alta" },
      409: { description: "La dirección ahora responde otro reloj" },
      502: { description: "El reloj no contesta o rechazó el usuario" },
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

  router.post("/query", requierePermiso("checador.ver"), asyncHandler(controller.table));
  router.get("/status", requierePermiso("checador.ver"), asyncHandler(controller.status));
  router.post("/import", requierePermiso("checador.sincronizar"), asyncHandler(controller.importar));
  router.post("/sync", requierePermiso("checador.sincronizar"), asyncHandler(controller.sync));

  router.post("/relojes", requierePermiso("relojes.administrar"), asyncHandler(controller.registrarReloj));
  router.patch("/relojes/:serie", requierePermiso("relojes.administrar"), asyncHandler(controller.actualizarReloj));
  router.delete("/relojes/:serie", requierePermiso("relojes.administrar"), asyncHandler(controller.darDeBajaReloj));
  router.get("/relojes/:serie/configuracion", requierePermiso("relojes.administrar"), asyncHandler(controller.configuracionReloj));

  router.post("/report", requierePermiso("checador.ver"), asyncHandler(controller.reporte));
  router.post("/report/export", requierePermiso("checador.ver"), asyncHandler(controller.reporteExport));

  router.post("/empleados/query", requierePermiso("checador.ver"), asyncHandler(controller.empleadosTable));
  router.post("/empleados/vincular-sugeridos", requierePermiso("checador.vincular"), asyncHandler(controller.vincularSugeridos));
  router.put("/empleados/:numero", requierePermiso("checador.vincular"), asyncHandler(controller.vincular));
  router.delete("/empleados/:numero", requierePermiso("checador.vincular"), asyncHandler(controller.desvincular));

  return router;
};
