import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  AsignadosListResponseSchema,
  DevicesListResponseSchema,
  ReportListResponseSchema,
  ReportQueryListSchema,
  ReportTableResponseSchema,
} from "../models/dto/report.dto";
import type { ReportController } from "../controllers/report.controller";

const bearer = [{ bearerAuth: [] }];

export const createReportsRouter = (controller: ReportController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/reports",
    tags: ["Reportes"],
    summary: "Reporte de entregas (cartas e items)",
    security: bearer,
    parameters: [
      { in: "query", name: "start", required: false, schema: { type: "string" } },
      { in: "query", name: "end", required: false, schema: { type: "string" } },
      { in: "query", name: "department", required: false, schema: { type: "string" } },
      { in: "query", name: "employee", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Filas", content: { "application/json": { schema: ReportListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/reports/.csv",
    tags: ["Reportes"],
    summary: "Exportar reporte de entregas a CSV",
    security: bearer,
    parameters: [
      { in: "query", name: "start", required: false, schema: { type: "string" } },
      { in: "query", name: "end", required: false, schema: { type: "string" } },
      { in: "query", name: "department", required: false, schema: { type: "string" } },
      { in: "query", name: "employee", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "CSV (text/csv)" },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/query",
    tags: ["Reportes"],
    summary: "Reporte de entregas con paginación server-side",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: { description: "Página", content: { "application/json": { schema: ReportTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/reports/asignados",
    tags: ["Reportes"],
    summary: "Dispositivos actualmente ASIGNADO y a cargo de quién",
    security: bearer,
    responses: {
      200: { description: "Filas", content: { "application/json": { schema: AsignadosListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/reports/devices",
    tags: ["Reportes"],
    summary: "Inventario completo de dispositivos con asignación activa",
    security: bearer,
    responses: {
      200: { description: "Filas", content: { "application/json": { schema: DevicesListResponseSchema } } },
    },
  });

  router.use(authenticate);

  router.get("/", requierePermiso("reportes.ver"), asyncHandler(controller.report));
  router.post("/query", requierePermiso("reportes.ver"), asyncHandler(controller.table));
  router.get("/.csv", requierePermiso("reportes.exportar"), asyncHandler(controller.csv));
  router.get("/asignados", requierePermiso("reportes.ver"), asyncHandler(controller.asignados));
  router.get("/devices", requierePermiso("reportes.ver"), asyncHandler(controller.devices));

  return router;
};