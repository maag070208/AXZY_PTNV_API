import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  ScheduleSchema,
  ScheduleCreateDto,
  ScheduleUpdateDto,
  AssignmentCreateDto,
  WeeklyAttendanceQueryDto,
  WeeklyAttendanceReportSchema,
  PeopleAttendanceQuerySchema,
  PeopleAttendanceResponseSchema,
} from "../models/dto/schedule.dto";
import type { ScheduleController } from "../controllers/schedule.controller";

const bearer = [{ bearerAuth: [] }];

export const createSchedulesRouter = (controller: ScheduleController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/schedules",
    tags: ["Schedules"],
    summary: "List schedules",
    security: bearer,
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Schedules", content: { "application/json": { schema: ScheduleSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/schedules",
    tags: ["Schedules"],
    summary: "Create schedule",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: ScheduleCreateDto } } } },
    responses: { 201: { description: "Created", content: { "application/json": { schema: ScheduleSchema } } } },
  });

  registerPath({
    method: "patch",
    path: "/schedules/{id}",
    tags: ["Schedules"],
    summary: "Update schedule",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: ScheduleUpdateDto } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: ScheduleSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/schedules/{id}",
    tags: ["Schedules"],
    summary: "Deactivate/delete schedule",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Resultado" } },
  });

  registerPath({
    method: "post",
    path: "/schedules/assignments",
    tags: ["Schedules"],
    summary: "Bulk assignment of a schedule to several people",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AssignmentCreateDto } } } },
    responses: { 201: { description: "Assigned" } },
  });

  registerPath({
    method: "post",
    path: "/schedules/weekly-attendance",
    tags: ["Schedules"],
    summary: "Weekly attendance report per department (entries, exits, hours, overtime vs approvals)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: WeeklyAttendanceQueryDto } } } },
    responses: {
      200: { description: "Report", content: { "application/json": { schema: WeeklyAttendanceReportSchema } } },
    },
  });

  for (const [path, source] of [
    ["/schedules/attendance/time-clock", "clock punches (time_clock.view)"],
    ["/schedules/attendance/access", "access log (access.log)"],
  ] as const) {
    registerPath({
      method: "post",
      path,
      tags: ["Schedules"],
      summary: `Entries/exits per person from the ${source}: each day of the period vs. the person's schedule`,
      security: bearer,
      request: { body: { required: true, content: { "application/json": { schema: PeopleAttendanceQuerySchema } } } },
      responses: {
        200: { description: "One row per person", content: { "application/json": { schema: PeopleAttendanceResponseSchema } } },
      },
    });
  }

  router.use(authenticate);

  // Catálogo (catálogos primero para no colisionar con rutas hijas).
  router.get("/", requiresPermission("schedules.view"), asyncHandler(controller.list));
  router.post("/", requiresPermission("schedules.manage"), asyncHandler(controller.create));

  router.post("/assignments", requiresPermission("schedules.manage"), asyncHandler(controller.assign));
  router.post("/assignments/remove", requiresPermission("schedules.manage"), asyncHandler(controller.removeAssignments));
  router.post("/assignments/query", requiresPermission("schedules.view"), asyncHandler(controller.assignmentsTable));

  router.get("/:id/assignees", requiresPermission("schedules.view"), asyncHandler(controller.assigned));

  // El detalle de horas extra (persona + día, con pendientes) es solo para
  // ADMIN/GERENTE. RH consume el export, que siempre devuelve solo lo aprobado.
  router.post("/weekly-attendance", requiresPermission("payroll.view"), asyncHandler(controller.weeklyAttendanceReport));
  // Pantalla de Entradas y salidas de RH: cada fuente con el permiso de su pantalla.
  router.post("/attendance/time-clock", requiresPermission("time_clock.view"), asyncHandler(controller.peopleAttendanceReport("TIME_CLOCK")));
  router.post("/attendance/access", requiresPermission("access.log"), asyncHandler(controller.peopleAttendanceReport("ACCESS")));
  router.post("/overtime/query", requiresPermission("overtime.approve"), asyncHandler(controller.overtime));
  router.post("/overtime/export", requiresPermission("overtime.view"), asyncHandler(controller.overtimeExport));

  router.patch("/:id", requiresPermission("schedules.manage"), asyncHandler(controller.update));
  router.delete("/:id", requiresPermission("schedules.manage"), asyncHandler(controller.remove));

  return router;
};
