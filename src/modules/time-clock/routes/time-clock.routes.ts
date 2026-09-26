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
    tags: ["Time clock"],
    summary: "Server-side table of time clock punches (filters: q, employeeNumber, method, from, to, tz)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: PunchQuerySchema } } } },
    responses: {
      200: { description: "Page of punches", content: { "application/json": { schema: PunchTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/time-clock/status",
    tags: ["Time clock"],
    summary: "Time clock sync status",
    security: bearer,
    responses: {
      200: { description: "Status", content: { "application/json": { schema: TimeClockStatusSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/import",
    tags: ["Time clock"],
    summary:
      "Import the punches of a day range from the clocks (read-only; runs in the background, progress in /time-clock/status)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockImportDto } } } },
    responses: {
      202: { description: "Import started", content: { "application/json": { schema: TimeClockImportSchema } } },
      400: { description: "Invalid dates or time zone" },
      409: { description: "An import is already in progress" },
      503: { description: "No TIME_CLOCK_USER or no registered clocks" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/sync",
    tags: ["Time clock"],
    summary:
      "Drains from each clock everything pending since its cursor (read-only; 202, progress in /time-clock/status)",
    security: bearer,
    responses: {
      202: { description: "Drenado iniciado", content: { "application/json": { schema: TimeClockProgressSchema } } },
      409: { description: "All clocks are already syncing" },
      503: { description: "No TIME_CLOCK_USER or no registered clocks" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/clocks",
    tags: ["Time clock"],
    summary:
      "Register a clock (ADMIN). Connects, reads its identity (read-only) and starts its sync",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockDto } } } },
    responses: {
      201: { description: "Clock registered", content: { "application/json": { schema: TimeClockDeviceSchema } } },
      400: { description: "Invalid address" },
      409: { description: "That clock (address or serial) is already registered" },
      502: { description: "The clock does not answer or rejected the user (TIME_CLOCK_UNREACHABLE / TIME_CLOCK_INVALID_CREDENTIALS)" },
      503: { description: "The API has no TIME_CLOCK_USER / TIME_CLOCK_PASS" },
    },
  });

  registerPath({
    method: "patch",
    path: "/time-clock/clocks/{serial}",
    tags: ["Time clock"],
    summary:
      "Change a clock's name or whether it counts for attendance (ADMIN). It is the system record: the clock is not touched",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TimeClockUpdateDto } } } },
    responses: {
      200: { description: "Clock updated", content: { "application/json": { schema: TimeClockDeviceSchema } } },
      400: { description: "No changes or empty name" },
      404: { description: "Not registered" },
    },
  });

  registerPath({
    method: "delete",
    path: "/time-clock/clocks/{serial}",
    tags: ["Time clock"],
    summary: "Remove a clock (ADMIN): it stops syncing; its punches and cursor are kept",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "{ dispositivoSerie }" }, 404: { description: "Not registered" } },
  });

  registerPath({
    method: "get",
    path: "/time-clock/clocks/{serial}/settings",
    tags: ["Time clock"],
    summary: "Settings read live from the clock (ADMIN; read-only): identity, time and people",
    security: bearer,
    parameters: [{ in: "path", name: "serial", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Setting", content: { "application/json": { schema: TimeClockConfigSchema } } },
      404: { description: "Not registered" },
      409: { description: "A different clock now answers at that address" },
      502: { description: "The clock does not answer or rejected the user" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/report",
    tags: ["Time clock"],
    summary:
      "Entries/exits from the clock punches (same contract as /access/report; matched by clock number)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockReportQuerySchema } } } },
    responses: {
      200: { description: "Page of sessions + summary", content: { "application/json": { schema: TimeClockReportResponseSchema } } },
      400: { description: "Invalid period/date/tz" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/report/export",
    tags: ["Time clock"],
    summary: "Same calculation as /time-clock/report, with ALL sessions (CSV/PDF)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockReportQuerySchema } } } },
    responses: {
      200: { description: "All sessions + summary", content: { "application/json": { schema: TimeClockReportExportResponseSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/employees/query",
    tags: ["Time clock"],
    summary: "Clock employees and their link to users (filters: q, status LINKED/UNLINKED/SUGGESTED)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: TimeClockEmployeesQuerySchema } } } },
    responses: {
      200: { description: "Page + summary", content: { "application/json": { schema: TimeClockEmployeesResponseSchema } } },
    },
  });

  registerPath({
    method: "put",
    path: "/time-clock/employees/{number}",
    tags: ["Time clock"],
    summary: "Link a clock number to a user (ADMIN/HUMAN_RESOURCES)",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TimeClockLinkDto } } } },
    responses: {
      200: { description: "Linked", content: { "application/json": { schema: TimeClockEmployeeSchema } } },
      404: { description: "Number without punches or nonexistent user" },
    },
  });

  registerPath({
    method: "delete",
    path: "/time-clock/employees/{number}",
    tags: ["Time clock"],
    summary: "Remove the link of a clock number (ADMIN/HUMAN_RESOURCES)",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Desvinculado" }, 404: { description: "It was not linked" } },
  });

  registerPath({
    method: "post",
    path: "/time-clock/employees/link-suggested",
    tags: ["Time clock"],
    summary: "Link all HIGH-confidence suggestions at once (name and number match)",
    security: bearer,
    responses: { 200: { description: "{ linked }" } },
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
