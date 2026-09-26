import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  AssignedDevicesExportResponseSchema,
  AssignedDevicesTableResponseSchema,
  DevicesExportResponseSchema,
  DevicesTableResponseSchema,
  PeriodDeliveriesResponseSchema,
  PeriodDetailResponseSchema,
  PeriodSummaryQuerySchema,
  PeriodSummaryResponseSchema,
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
    tags: ["Reports"],
    summary: "Delivery report (letters and items)",
    security: bearer,
    parameters: [
      { in: "query", name: "start", required: false, schema: { type: "string" } },
      { in: "query", name: "end", required: false, schema: { type: "string" } },
      { in: "query", name: "department", required: false, schema: { type: "string" } },
      { in: "query", name: "employee", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Rows", content: { "application/json": { schema: ReportListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/reports/.csv",
    tags: ["Reports"],
    summary: "Export delivery report to CSV",
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
    tags: ["Reports"],
    summary: "Delivery report with server-side pagination",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: { description: "Page", content: { "application/json": { schema: ReportTableResponseSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/period-summary",
    tags: ["Reports"],
    summary: "Period summary: delivered, returned and admitted with daily buckets and KPIs",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PeriodSummaryQuerySchema } } },
    },
    responses: {
      200: {
        description: "Period summary",
        content: { "application/json": { schema: PeriodSummaryResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/period-summary/detail",
    tags: ["Reports"],
    summary: "Deliveries of the period (detail that feeds the narrative PDF)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PeriodSummaryQuerySchema } } },
    },
    responses: {
      200: {
        description: "Detail rows",
        content: { "application/json": { schema: PeriodDetailResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/period-summary/deliveries",
    tags: ["Reports"],
    summary: "Deliveries of the period (server-side table with column filters and sorting)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: {
        description: "Page of deliveries",
        content: { "application/json": { schema: PeriodDeliveriesResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/assigned-devices",
    tags: ["Reports"],
    summary: "Devices currently ASSIGNED and who holds them (server-side table)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: {
        description: "Page with stats",
        content: { "application/json": { schema: AssignedDevicesTableResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/assigned-devices/export",
    tags: ["Reports"],
    summary: "Export the filtered assigned devices universe",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: {
        description: "Rows with stats and truncation flag",
        content: { "application/json": { schema: AssignedDevicesExportResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/devices",
    tags: ["Reports"],
    summary: "Full device inventory with active assignment (server-side table)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: {
        description: "Page with stats",
        content: { "application/json": { schema: DevicesTableResponseSchema } },
      },
    },
  });

  registerPath({
    method: "post",
    path: "/reports/devices/export",
    tags: ["Reports"],
    summary: "Export the filtered device universe",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ReportQueryListSchema } } } },
    responses: {
      200: {
        description: "Rows with stats and truncation flag",
        content: { "application/json": { schema: DevicesExportResponseSchema } },
      },
    },
  });

  router.use(authenticate);

  router.get("/", requiresPermission("reports.view"), asyncHandler(controller.report));
  router.post("/query", requiresPermission("reports.view"), asyncHandler(controller.table));
  router.get("/.csv", requiresPermission("reports.export"), asyncHandler(controller.csv));
  router.post("/period-summary", requiresPermission("reports.view"), asyncHandler(controller.periodSummary));
  // Tabla = `reports.view`; el PDF del periodo (`.../detail`) = `reports.export`.
  router.post(
    "/period-summary/deliveries",
    requiresPermission("reports.view"),
    asyncHandler(controller.periodDeliveries)
  );
  router.post(
    "/period-summary/detail",
    requiresPermission("reports.export"),
    asyncHandler(controller.periodDetail)
  );
  router.post("/assigned-devices", requiresPermission("reports.view"), asyncHandler(controller.assigned));
  router.post(
    "/assigned-devices/export",
    requiresPermission("reports.export"),
    asyncHandler(controller.assignedExport)
  );
  router.post("/devices", requiresPermission("reports.view"), asyncHandler(controller.devices));
  router.post("/devices/export", requiresPermission("reports.export"), asyncHandler(controller.devicesExport));

  return router;
};