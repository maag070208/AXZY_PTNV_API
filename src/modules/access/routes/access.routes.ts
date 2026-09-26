import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  AccessEventCreateSchema,
  AccessEventSchema,
  AccessEventVoidDto,
  AccessLookupDto,
  AccessLookupResultSchema,
  AccessQueryListSchema,
  AccessStatusSchema,
  AccessTableResponseSchema,
  AccessTodayResponseSchema,
  SiteCreateDto,
  SiteSchema,
  SiteUpdateDto,
} from "../models/dto/access.dto";
import {
  AccessReportExportResponseSchema,
  AccessReportQuerySchema,
  AccessReportResponseSchema,
} from "../models/dto/access-report.dto";
import type { AccessController } from "../controllers/access.controller";

const bearer = [{ bearerAuth: [] }];

export const createAccessRouter = (controller: AccessController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/access/lookup",
    tags: ["Access"],
    summary: "Resolver un QR de credencial a resumen del empleado (GUARD/ADMIN)",
    description:
      "Devuelve el resumen del empleado. `fotoUrl` es una ruta RELATIVA a la base " +
      "de la API (ej. `/personal/{id}/foto/raw`): no incluye host ni el prefijo " +
      "`/api/v1`. El cliente debe resolverla contra su base de API " +
      "(web: `${BASE_URL}${fotoUrl}`; app: ruta relativa contra su ApiClient). " +
      "Es `null` si el empleado no tiene foto.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessLookupDto } } } },
    responses: {
      200: {
        description: "Resumen del empleado",
        content: {
          "application/json": {
            schema: AccessLookupResultSchema,
            example: {
              id: "9b1c2d3e-4f5a-4b6c-8d7e-1f2a3b4c5d6e",
              name: "Ana Palma",
              employeeNumber: "E2E-001",
              jobTitle: "Analista",
              department: "Sistemas",
              active: true,
              photoUrl: "/hr/9b1c2d3e-4f5a-4b6c-8d7e-1f2a3b4c5d6e/photo/raw",
              credentialVersion: 2,
              lastEvent: null,
              suggestedType: "ENTRY",
            },
          },
        },
      },
      400: { description: "QR mal formado" },
      404: { description: "Empleado no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/events",
    tags: ["Access"],
    summary: "Registrar un evento de acceso (GUARD/ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessEventCreateSchema } } } },
    responses: {
      201: { description: "Evento creado", content: { "application/json": { schema: AccessEventSchema } } },
      200: { description: "Idempotente: el evento ya existía (mismo clientEventId)", content: { "application/json": { schema: AccessEventSchema } } },
      400: { description: "Body inválido / QR mal formado" },
      404: { description: "Empleado o sitio no encontrado" },
      409: { description: "Empleado inactivo, duplicado o secuencia inconsistente" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/status/{employeeId}",
    tags: ["Access"],
    summary: "Último evento de un empleado y sugerencia ENTRY/EXIT (GUARD/ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Estado del empleado", content: { "application/json": { schema: AccessStatusSchema } } },
      404: { description: "Empleado no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/query",
    tags: ["Access"],
    summary: "Tabla server-side de eventos de acceso (ADMIN/GERENTE/RECURSOS_HUMANOS)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessQueryListSchema } } } },
    responses: {
      200: { description: "Página de eventos", content: { "application/json": { schema: AccessTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/access/sites",
    tags: ["Access"],
    summary: "Catálogo de sitios activos (cualquier rol autenticado)",
    security: bearer,
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: {
      200: { description: "Lista de sitios", content: { "application/json": { schema: SiteSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/access/sites",
    tags: ["Access"],
    summary: "Alta de sitio (ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: SiteCreateDto } } } },
    responses: {
      201: { description: "Sitio creado", content: { "application/json": { schema: SiteSchema } } },
      409: { description: "Nombre o código duplicado" },
    },
  });

  registerPath({
    method: "put",
    path: "/access/sites/{id}",
    tags: ["Access"],
    summary: "Edición de sitio (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SiteUpdateDto } } } },
    responses: {
      200: { description: "Sitio actualizado", content: { "application/json": { schema: SiteSchema } } },
      404: { description: "Sitio no encontrado" },
      409: { description: "Nombre o código duplicado" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/me/today",
    tags: ["Access"],
    summary: "Escaneos del guardia en el día (GUARD)",
    security: bearer,
    responses: {
      200: {
        description: "Eventos de hoy",
        content: { "application/json": { schema: AccessTodayResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/access/report",
    tags: ["Access"],
    summary: "Reporte de entradas/salidas por persona (ADMIN/GERENTE/RECURSOS_HUMANOS)",
    description:
      "Una fila por persona (incluidas las sin registros) en la ventana del `period` " +
      "(DAY/WEEK/MONTH) sobre el día local `date`. El cliente envía `date` y `tz`; la API " +
      "calcula `[start, end)`. Emparejamiento por suma de pares ENTRY/EXIT; los anulados se " +
      "excluyen. El resumen es global, no de la página.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessReportQuerySchema } } } },
    responses: {
      200: { description: "Página del reporte + resumen global", content: { "application/json": { schema: AccessReportResponseSchema } } },
      400: { description: "period/date/tz inválidos (code: INVALID_REPORT_PERIOD | INVALID_REPORT_DATE | INVALID_TIMEZONE)" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/report/export",
    tags: ["Access"],
    summary: "Reporte de entradas/salidas por persona — universo completo, sin paginar (ADMIN/GERENTE/RECURSOS_HUMANOS)",
    description:
      "Mismo cálculo que `/access/report`, pero devuelve TODAS las filas del universo " +
      "(sin paginar) junto con el resumen global.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessReportQuerySchema } } } },
    responses: {
      200: { description: "Universo completo + resumen global", content: { "application/json": { schema: AccessReportExportResponseSchema } } },
      400: { description: "period/date/tz inválidos (code: INVALID_REPORT_PERIOD | INVALID_REPORT_DATE | INVALID_TIMEZONE)" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/{id}",
    tags: ["Access"],
    summary: "Detalle de un evento de acceso (ADMIN/GERENTE/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Evento", content: { "application/json": { schema: AccessEventSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/{id}/void",
    tags: ["Access"],
    summary: "Anulación lógica de un evento (ADMIN/RECURSOS_HUMANOS)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: AccessEventVoidDto } } } },
    responses: {
      200: { description: "Evento anulado (o ya anulado: idempotente)", content: { "application/json": { schema: AccessEventSchema } } },
      404: { description: "No encontrado" },
    },
  });

  router.use(authenticate);

  // Rutas específicas antes de "/:id" para no colisionar.
  router.post("/lookup", requiresPermission("access.scan"), asyncHandler(controller.lookup));
  router.post("/events", requiresPermission("access.scan"), asyncHandler(controller.createEvent));
  router.get("/status/:employeeId", requiresPermission("access.scan"), asyncHandler(controller.status));
  router.post("/query", requiresPermission("access.log"), asyncHandler(controller.table));
  router.post("/stats", requiresPermission("access.log"), asyncHandler(controller.stats));
  router.post("/report", requiresPermission("access.log"), asyncHandler(controller.report));
  router.post("/report/export", requiresPermission("access.log"), asyncHandler(controller.reportExport));
  router.get("/me/today", requiresPermission("access.scan"), asyncHandler(controller.meToday));
  router.get("/sites", asyncHandler(controller.sites));
  router.post("/sites", requiresPermission("access.sites"), asyncHandler(controller.createSite));
  router.put("/sites/:id", requiresPermission("access.sites"), asyncHandler(controller.updateSite));

  router.get("/:id", requiresPermission("access.log"), asyncHandler(controller.getOne));
  router.post("/:id/void", requiresPermission("access.void"), asyncHandler(controller.voidEvent));

  return router;
};
