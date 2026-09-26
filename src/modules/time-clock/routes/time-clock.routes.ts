import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  PunchQuerySchema,
  PunchTableResponseSchema,
  TimeClockEmployeeSchema,
  TimeClockEmployeesQuerySchema,
  TimeClockEmployeesResponseSchema,
  TimeClockImportDto,
  TimeClockImportSchema,
  TimeClockDeviceSchema,
  TimeClockProgressSchema,
  TimeClockConfigSchema,
  TimeClockDto,
  TimeClockUpdateDto,
  TimeClockReportExportResponseSchema,
  TimeClockReportQuerySchema,
  TimeClockReportResponseSchema,
  TimeClockStatusSchema,
  TimeClockLinkDto,
} from "../models/dto/time-clock.dto";
import type { TimeClockController } from "../controllers/time-clock.controller";

const bearer = [{ bearerAuth: [] }];

export const createTimeClockRouter = (controller: TimeClockController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/time-clock/query",
    tags: ["Checador"],
    summary: "Tabla server-side de checadas del reloj (filtros: q, numeroEmpleado, metodo, desde, hasta, tz)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: PunchQuerySchema } } } },
    responses: {
      200: { description: "Página de checadas", content: { "application/json": { schema: PunchTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/time-clock/status",
    tags: ["Checador"],
    summary: "Estado de la sincronización con el reloj",
    security: bearer,
    responses: {
      200: { description: "Estado", content: { "application/json": { schema: TimeClockStatusSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/import",
    tags: ["Checador"],
    summary:
      "Importar del reloj las checadas de un rango de días (solo lee del reloj; corre en segundo plano, avance en /checador/status)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockImportDto } } } },
    responses: {
      202: { description: "Importación iniciada", content: { "application/json": { schema: TimeClockImportSchema } } },
      400: { description: "Fechas o zona horaria inválidas" },
      409: { description: "Ya hay una importación en curso" },
      503: { description: "Sin CHECADOR_USER o sin relojes dados de alta" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/sync",
    tags: ["Checador"],
    summary:
      "Drena de cada reloj todo lo que falte desde su cursor (solo lee; 202, avance en /checador/status)",
    security: bearer,
    responses: {
      202: { description: "Drenado iniciado", content: { "application/json": { schema: TimeClockProgressSchema } } },
      409: { description: "Todos los relojes ya están sincronizando" },
      503: { description: "Sin CHECADOR_USER o sin relojes dados de alta" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/clocks",
    tags: ["Checador"],
    summary:
      "Dar de alta un reloj (ADMIN). Se conecta y lee su identidad (solo lectura) y arranca su sincronización",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockDto } } } },
    responses: {
      201: { description: "Reloj dado de alta", content: { "application/json": { schema: TimeClockDeviceSchema } } },
      400: { description: "Dirección inválida" },
      409: { description: "Ese reloj (dirección o serie) ya está dado de alta" },
      502: { description: "El reloj no contesta o rechazó el usuario (CHECADOR_SIN_CONEXION / CHECADOR_CREDENCIALES)" },
      503: { description: "La API no tiene CHECADOR_USER / CHECADOR_PASS" },
    },
  });

  registerPath({
    method: "patch",
    path: "/time-clock/clocks/{serial}",
    tags: ["Checador"],
    summary:
      "Cambiar el nombre de un reloj o si cuenta para entradas/salidas (ADMIN). Es el registro del sistema: no toca el reloj",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TimeClockUpdateDto } } } },
    responses: {
      200: { description: "Reloj actualizado", content: { "application/json": { schema: TimeClockDeviceSchema } } },
      400: { description: "Sin cambios o nombre vacío" },
      404: { description: "No está dado de alta" },
    },
  });

  registerPath({
    method: "delete",
    path: "/time-clock/clocks/{serial}",
    tags: ["Checador"],
    summary: "Dar de baja un reloj (ADMIN): deja de sincronizarse; sus checadas y su cursor se quedan",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "{ dispositivoSerie }" }, 404: { description: "No está dado de alta" } },
  });

  registerPath({
    method: "get",
    path: "/time-clock/clocks/{serial}/settings",
    tags: ["Checador"],
    summary: "Configuración leída en vivo del reloj (ADMIN; solo lectura): identidad, hora y personas",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Configuración", content: { "application/json": { schema: TimeClockConfigSchema } } },
      404: { description: "No está dado de alta" },
      409: { description: "La dirección ahora responde otro reloj" },
      502: { description: "El reloj no contesta o rechazó el usuario" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/report",
    tags: ["Checador"],
    summary:
      "Entradas/salidas a partir de las checadas del reloj (mismo contrato que /access/report; relación por número del reloj)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockReportQuerySchema } } } },
    responses: {
      200: { description: "Página de sesiones + resumen", content: { "application/json": { schema: TimeClockReportResponseSchema } } },
      400: { description: "period/date/tz inválidos" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/report/export",
    tags: ["Checador"],
    summary: "Mismo cálculo que /checador/report, con TODAS las sesiones (CSV/PDF)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockReportQuerySchema } } } },
    responses: {
      200: { description: "Todas las sesiones + resumen", content: { "application/json": { schema: TimeClockReportExportResponseSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/employees/query",
    tags: ["Checador"],
    summary: "Empleados del reloj y su vínculo con usuarios (filtros: q, estado VINCULADO/SIN_VINCULAR/SUGERIDO)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockEmployeesQuerySchema } } } },
    responses: {
      200: { description: "Página + resumen", content: { "application/json": { schema: TimeClockEmployeesResponseSchema } } },
    },
  });

  registerPath({
    method: "put",
    path: "/time-clock/employees/{number}",
    tags: ["Checador"],
    summary: "Vincular un número del reloj con un usuario (ADMIN/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TimeClockLinkDto } } } },
    responses: {
      200: { description: "Vinculado", content: { "application/json": { schema: TimeClockEmployeeSchema } } },
      404: { description: "Número sin checadas o usuario inexistente" },
    },
  });

  registerPath({
    method: "delete",
    path: "/time-clock/employees/{number}",
    tags: ["Checador"],
    summary: "Quitar el vínculo de un número del reloj (ADMIN/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Desvinculado" }, 404: { description: "No estaba vinculado" } },
  });

  registerPath({
    method: "post",
    path: "/time-clock/employees/link-suggested",
    tags: ["Checador"],
    summary: "Vincular de un jalón las sugerencias de confianza ALTA (nombre y número coinciden)",
    security: bearer,
    responses: { 200: { description: "{ vinculados }" } },
  });

  router.use(authenticate);

  router.post("/query", requiresPermission("time_clock.view"), asyncHandler(controller.table));
  router.get("/status", requiresPermission("time_clock.view"), asyncHandler(controller.status));
  router.post("/import", requiresPermission("time_clock.sync"), asyncHandler(controller.startImport));
  router.post("/sync", requiresPermission("time_clock.sync"), asyncHandler(controller.sync));

  router.post("/clocks", requiresPermission("time_clocks.manage"), asyncHandler(controller.registerClock));
  router.patch("/clocks/:serial", requiresPermission("time_clocks.manage"), asyncHandler(controller.updateClock));
  router.delete("/clocks/:serial", requiresPermission("time_clocks.manage"), asyncHandler(controller.retireClock));
  router.get("/clocks/:serial/settings", requiresPermission("time_clocks.manage"), asyncHandler(controller.clockSettings));

  router.post("/report", requiresPermission("time_clock.view"), asyncHandler(controller.getReport));
  router.post("/report/export", requiresPermission("time_clock.view"), asyncHandler(controller.reportExport));

  router.post("/employees/query", requiresPermission("time_clock.view"), asyncHandler(controller.employeesTable));
  router.post("/employees/link-suggested", requiresPermission("time_clock.link"), asyncHandler(controller.linkSuggested));
  router.put("/employees/:number", requiresPermission("time_clock.link"), asyncHandler(controller.linkEmployee));
  router.delete("/employees/:number", requiresPermission("time_clock.link"), asyncHandler(controller.unlinkEmployee));

  return router;
};
