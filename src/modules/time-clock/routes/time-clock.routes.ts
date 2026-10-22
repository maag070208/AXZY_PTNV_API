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
  TimeClockRosterSchema,
  TimeClockRosterRunResultSchema,
  TimeClockRosterRemovalDto,
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
    method: "get",
    path: "/time-clock/roster",
    tags: ["Time clock"],
    summary: "Padrón del reloj: nuevos en el reloj, bajas pendientes y reapariciones (solo lectura de la BD)",
    security: bearer,
    responses: { 200: { description: "Padrón", content: { "application/json": { schema: TimeClockRosterSchema } } } },
  });

  registerPath({
    method: "post",
    path: "/time-clock/roster/run",
    tags: ["Time clock"],
    summary: "Revisa el padrón contra los relojes que cuentan (solo lectura del reloj)",
    security: bearer,
    responses: {
      200: { description: "Resultado", content: { "application/json": { schema: TimeClockRosterRunResultSchema } } },
      409: { description: "Ya hay una revisión en curso" },
      503: { description: "No TIME_CLOCK_USER" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/roster/employees/{number}/removal",
    tags: ["Time clock"],
    summary: "Aplica la baja pendiente de una persona con motivo (da de baja al usuario)",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: TimeClockRosterRemovalDto } } } },
    responses: {
      200: { description: "Baja aplicada" },
      404: { description: "No vinculado" },
      409: { description: "No tiene baja pendiente" },
    },
  });

  registerPath({
    method: "post",
    path: "/time-clock/roster/employees/{number}/dismiss",
    tags: ["Time clock"],
    summary: "Descarta la baja pendiente sin motivo",
    security: bearer,
    parameters: [{ in: "path", name: "number", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Descartada" },
      404: { description: "No vinculado" },
      409: { description: "No tiene baja pendiente" },
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

  registerPath({
    method: "get",
    path: "/time-clock/clocks/{serial}/events",
    tags: ["Time clock"],
    summary: "Timeline de un reloj: últimos intentos de sincronización y resumen (sesión con time_clock.view)",
    security: bearer,
    parameters: [
      { in: "path", name: "serial", required: true, schema: { type: "string" } },
      { in: "query", name: "limit", required: false, schema: { type: "integer", default: 50, maximum: 200 } },
    ],
    responses: {
      200: { description: "{ clockSerial, events[], summary }" },
      404: { description: "Ese reloj no está dado de alta" },
    },
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
  router.get("/clocks/:serial/events", requiresPermission("time_clock.view"), asyncHandler(controller.clockEvents));

  // Lo que tiene el reloj (solo lectura del equipo).
  router.get("/clocks/:serial/inspect/overview", requiresPermission("time_clocks.manage"), asyncHandler(controller.inspectOverview));
  router.get("/clocks/:serial/inspect/users", requiresPermission("time_clocks.manage"), asyncHandler(controller.inspectUsers));
  router.get("/clocks/:serial/inspect/cards", requiresPermission("time_clocks.manage"), asyncHandler(controller.inspectCards));
  router.get("/clocks/:serial/inspect/events", requiresPermission("time_clocks.manage"), asyncHandler(controller.inspectEvents));
  // Resumen de estado para el dashboard del reloj (lectura de la base + caché del equipo).
  router.get("/summary", requiresPermission("time_clocks.manage"), asyncHandler(controller.summary));
  router.get("/clocks/:serial/inspect/camera", requiresPermission("time_clocks.manage"), asyncHandler(controller.inspectCamera));

  // Personas y tarjetas del reloj (CRUD; las altas, cambios y bajas ESCRIBEN en el reloj).
  router.get("/people/unified", requiresPermission("time_clocks.manage"), asyncHandler(controller.peopleUnified));
  router.get("/clocks/:serial/people", requiresPermission("time_clocks.manage"), asyncHandler(controller.peopleList));
  router.post("/clocks/:serial/people", requiresPermission("time_clock.write"), asyncHandler(controller.peopleCreate));
  router.get("/employees/:userId/clock-status", requiresPermission("time_clocks.manage"), asyncHandler(controller.employeeClockStatus));
  // Lector de huellas (estación de enrolamiento): solo estado y captura de prueba; no guarda nada.
  router.get("/fingerprint-station", requiresPermission("time_clocks.manage"), asyncHandler(controller.fingerprintStationInfo));
  router.post("/fingerprint-station/test", requiresPermission("time_clocks.manage"), asyncHandler(controller.fingerprintStationTest));
  router.get("/employees/:userId/fingerprint/status", requiresPermission("time_clocks.manage"), asyncHandler(controller.fingerprintStatus));
  router.post("/employees/:userId/fingerprint/capture", requiresPermission("time_clock.write"), asyncHandler(controller.fingerprintCapture));
  router.post("/employees/:userId/fingerprint/apply", requiresPermission("time_clock.write"), asyncHandler(controller.fingerprintApply));
  router.post("/employees/:userId/clock-baja-all", requiresPermission("time_clock.write"), asyncHandler(controller.employeeClockBajaAll));
  router.post("/employees/:userId/clock-alta-all", requiresPermission("time_clock.write"), asyncHandler(controller.employeeClockAltaAll));
  router.post("/employees/:userId/clock-alta", requiresPermission("time_clock.write"), asyncHandler(controller.employeeClockAlta));
  router.get("/clocks/:serial/people/biometrics", requiresPermission("time_clocks.manage"), asyncHandler(controller.peopleBiometrics));
  router.get("/clocks/:serial/people/:employeeNo", requiresPermission("time_clocks.manage"), asyncHandler(controller.personDetail));
  router.get("/clocks/:serial/people/:employeeNo/photo", requiresPermission("time_clocks.manage"), asyncHandler(controller.personPhoto));
  router.patch("/clocks/:serial/people/:employeeNo", requiresPermission("time_clock.write"), asyncHandler(controller.peopleRename));
  router.delete("/clocks/:serial/people/:employeeNo", requiresPermission("time_clock.write"), asyncHandler(controller.peopleRemove));
  router.post("/clocks/:serial/people/:employeeNo/cards", requiresPermission("time_clock.write"), asyncHandler(controller.peopleAddCard));
  router.delete("/clocks/:serial/cards/:cardNo", requiresPermission("time_clock.write"), asyncHandler(controller.peopleRemoveCard));

  router.post("/report", requiresPermission("time_clock.view"), asyncHandler(controller.getReport));
  router.post("/report/export", requiresPermission("time_clock.view"), asyncHandler(controller.reportExport));

  router.post("/employees/query", requiresPermission("time_clock.view"), asyncHandler(controller.employeesTable));
  router.post("/employees/link-suggested", requiresPermission("time_clock.link"), asyncHandler(controller.linkSuggested));

  // Padrón del reloj (TIME_CLOCK_SYNC.md). Las bajas usan el permiso de dar de baja usuarios.
  router.get("/roster", requiresPermission("time_clock.view"), asyncHandler(controller.roster));
  router.post("/roster/run", requiresPermission("time_clock.sync"), asyncHandler(controller.runRoster));
  router.post(
    "/roster/employees/:number/removal",
    requiresPermission("users.edit"),
    asyncHandler(controller.applyRemoval)
  );
  // Catálogo de motivos de baja: lectura con el padrón; alta y cambios con catalogs.manage.
  router.get("/removal-categories", requiresPermission("time_clock.view"), asyncHandler(controller.listRemovalCategories));
  router.post("/removal-categories", requiresPermission("catalogs.manage"), asyncHandler(controller.createRemovalCategory));
  router.patch("/removal-categories/:id", requiresPermission("catalogs.manage"), asyncHandler(controller.updateRemovalCategory));

  router.post(
    "/roster/employees/:number/dismiss",
    requiresPermission("time_clock.link"),
    asyncHandler(controller.dismissRemoval)
  );
  router.put("/employees/:number", requiresPermission("time_clock.link"), asyncHandler(controller.linkEmployee));
  router.delete("/employees/:number", requiresPermission("time_clock.link"), asyncHandler(controller.unlinkEmployee));

  return router;
};
