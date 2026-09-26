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
    summary: "Resolve a badge QR code to the employee summary (GUARD/ADMIN)",
    description:
      "Returns the employee summary. `photoUrl` is a path RELATIVE to the " +
      "API base (e.g. `/hr/{id}/photo/raw`): it includes neither the host nor the " +
      "`/api/v1` prefix. The client must resolve it against its API base " +
      "(web: `${BASE_URL}${photoUrl}`; app: relative path against its ApiClient). " +
      "It is `null` when the employee has no photo.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessLookupDto } } } },
    responses: {
      200: {
        description: "Employee summary",
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
      400: { description: "Malformed QR code" },
      404: { description: "Employee not found" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/events",
    tags: ["Access"],
    summary: "Record an access event (GUARD/ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessEventCreateSchema } } } },
    responses: {
      201: { description: "Event created", content: { "application/json": { schema: AccessEventSchema } } },
      200: { description: "Idempotent: the event already existed (same clientEventId)", content: { "application/json": { schema: AccessEventSchema } } },
      400: { description: "Invalid body / malformed QR code" },
      404: { description: "Employee or site not found" },
      409: { description: "Inactive employee, duplicate or inconsistent sequence" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/status/{employeeId}",
    tags: ["Access"],
    summary: "Employee's last event and ENTRY/EXIT suggestion (GUARD/ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Employee status", content: { "application/json": { schema: AccessStatusSchema } } },
      404: { description: "Employee not found" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/query",
    tags: ["Access"],
    summary: "Server-side table of access events (ADMIN/MANAGER/HUMAN_RESOURCES)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessQueryListSchema } } } },
    responses: {
      200: { description: "Page of events", content: { "application/json": { schema: AccessTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/access/sites",
    tags: ["Access"],
    summary: "Catalog of active sites (any authenticated role)",
    security: bearer,
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: {
      200: { description: "Site list", content: { "application/json": { schema: SiteSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/access/sites",
    tags: ["Access"],
    summary: "Create site (ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: SiteCreateDto } } } },
    responses: {
      201: { description: "Site created", content: { "application/json": { schema: SiteSchema } } },
      409: { description: "Duplicate name or code" },
    },
  });

  registerPath({
    method: "put",
    path: "/access/sites/{id}",
    tags: ["Access"],
    summary: "Edit site (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SiteUpdateDto } } } },
    responses: {
      200: { description: "Site updated", content: { "application/json": { schema: SiteSchema } } },
      404: { description: "Site not found" },
      409: { description: "Duplicate name or code" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/me/today",
    tags: ["Access"],
    summary: "Guard's scans of the day (GUARD)",
    security: bearer,
    responses: {
      200: {
        description: "Today's events",
        content: { "application/json": { schema: AccessTodayResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/access/report",
    tags: ["Access"],
    summary: "Entries/exits report per person (ADMIN/MANAGER/HUMAN_RESOURCES)",
    description:
      "One row per person (including those without records) in the `period` window " +
      "(DAY/WEEK/MONTH) around the local day `date`. The client sends `date` and `tz`; the API " +
      "computes `[start, end)`. Pairing by summing ENTRY/EXIT pairs; voided events are " +
      "excluded. The summary is global, not per page.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessReportQuerySchema } } } },
    responses: {
      200: { description: "Report page + global summary", content: { "application/json": { schema: AccessReportResponseSchema } } },
      400: { description: "Invalid period/date/tz (code: INVALID_REPORT_PERIOD | INVALID_REPORT_DATE | INVALID_TIMEZONE)" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/report/export",
    tags: ["Access"],
    summary: "Entries/exits report per person — full universe, unpaginated (ADMIN/MANAGER/HUMAN_RESOURCES)",
    description:
      "Same calculation as `/access/report`, but returns ALL rows of the universe " +
      "(unpaginated) along with the global summary.",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AccessReportQuerySchema } } } },
    responses: {
      200: { description: "Full universe + global summary", content: { "application/json": { schema: AccessReportExportResponseSchema } } },
      400: { description: "Invalid period/date/tz (code: INVALID_REPORT_PERIOD | INVALID_REPORT_DATE | INVALID_TIMEZONE)" },
    },
  });

  registerPath({
    method: "get",
    path: "/access/{id}",
    tags: ["Access"],
    summary: "Access event detail (ADMIN/MANAGER/HUMAN_RESOURCES)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Event", content: { "application/json": { schema: AccessEventSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/access/{id}/void",
    tags: ["Access"],
    summary: "Logical voiding of an event (ADMIN/HUMAN_RESOURCES)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: AccessEventVoidDto } } } },
    responses: {
      200: { description: "Event voided (or already voided: idempotent)", content: { "application/json": { schema: AccessEventSchema } } },
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
