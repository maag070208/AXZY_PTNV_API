import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { DashboardSummarySchema } from "../models/dto/dashboard.dto";
import type { DashboardController } from "../controllers/dashboard.controller";

export const createDashboardRouter = (controller: DashboardController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/dashboard/summary",
    tags: ["Dashboard"],
    summary: "KPIs and recent activity of the admin dashboard (ADMIN/MANAGER)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Summary", content: { "application/json": { schema: DashboardSummarySchema } } },
    },
  });

  // Widgets de los tableros por rol: cada uno pide su permiso y el servicio
  // recorta los datos con el alcance (propio / área / todo).
  const widgets: Array<{ path: string; permission: string; summary: string }> = [
    { path: "hr-records", permission: "hr.records", summary: "Incomplete employee records (required documents, other documents, personal data)" },
    { path: "people", permission: "hr.records", summary: "Staff overview: active, hires/departures this month, birthdays, anniversaries, disciplinary reports" },
    { path: "attendance-today", permission: "attendance.view", summary: "Today's attendance (present, late, not arrived, on site) within the permission scope" },
    { path: "overtime-week", permission: "overtime.view", summary: "Overtime of the current week: calculated vs approved vs not approved" },
    { path: "setup-gaps", permission: "time_clock.link", summary: "Unlinked time clock numbers and staff without clock link or schedule" },
    { path: "tickets", permission: "tickets.view", summary: "Tickets within the permission scope: by status, unassigned, stale, open per assignee" },
    { path: "tasks", permission: "tasks.view", summary: "Tasks within the permission scope (own / team / all): by status, overdue, pending per person" },
    { path: "my-equipment", permission: "(session)", summary: "Equipment on the user's active custody letters" },
    { path: "access-today", permission: "access.scan", summary: "Today's access log: entries, exits, people on site, latest events" },
    { path: "system-health", permission: "system.configure", summary: "Inventory audit, time clock sync and email queue status" },
  ];
  for (const w of widgets) {
    registerPath({
      method: "get",
      path: `/dashboard/${w.path}`,
      tags: ["Dashboard"],
      summary: w.summary,
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: "Widget data" } },
    });
  }

  router.use(authenticate);
  router.get("/summary", requiresPermission("dashboard.view"), asyncHandler(controller.summary));
  router.get("/hr-records", requiresPermission("hr.records"), asyncHandler(controller.hrRecords));
  router.get("/people", requiresPermission("hr.records"), asyncHandler(controller.peopleOverview));
  router.get("/attendance-today", requiresPermission("attendance.view"), asyncHandler(controller.attendanceToday));
  router.get("/overtime-week", requiresPermission("overtime.view"), asyncHandler(controller.overtimeWeek));
  router.get("/setup-gaps", requiresPermission("time_clock.link"), asyncHandler(controller.setupGaps));
  router.get("/tickets", requiresPermission("tickets.view"), asyncHandler(controller.tickets));
  router.get("/tasks", requiresPermission("tasks.view"), asyncHandler(controller.tasks));
  // Solo su propio equipo: basta la sesión.
  router.get("/my-equipment", asyncHandler(controller.myEquipment));
  router.get("/access-today", requiresPermission("access.scan"), asyncHandler(controller.accessToday));
  router.get("/system-health", requiresPermission("system.configure"), asyncHandler(controller.systemHealth));

  return router;
};
