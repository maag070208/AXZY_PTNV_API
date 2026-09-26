import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  AssignedDevicesListResponseSchema,
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
    method: "get",
    path: "/reports/assigned-devices",
    tags: ["Reports"],
    summary: "Devices currently ASSIGNED and who holds them",
    security: bearer,
    responses: {
      200: { description: "Rows", content: { "application/json": { schema: AssignedDevicesListResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/reports/devices",
    tags: ["Reports"],
    summary: "Full device inventory with active assignment",
    security: bearer,
    responses: {
      200: { description: "Rows", content: { "application/json": { schema: DevicesListResponseSchema } } },
    },
  });

  router.use(authenticate);

  router.get("/", requiresPermission("reports.view"), asyncHandler(controller.report));
  router.post("/query", requiresPermission("reports.view"), asyncHandler(controller.table));
  router.get("/.csv", requiresPermission("reports.export"), asyncHandler(controller.csv));
  router.get("/assigned-devices", requiresPermission("reports.view"), asyncHandler(controller.assigned));
  router.get("/devices", requiresPermission("reports.view"), asyncHandler(controller.devices));

  return router;
};