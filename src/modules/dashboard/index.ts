import { prismaClient } from "@core/config/database";
import type { EmployeeRecordsService } from "@modules/hr";
import type { WeeklyAttendanceService } from "@modules/schedules/services/weekly-attendance.service";
import { DashboardService } from "./services/dashboard.service";
import { PeopleDashboardService } from "./services/people-dashboard.service";
import { WorkDashboardService } from "./services/work-dashboard.service";
import { DashboardController } from "./controllers/dashboard.controller";
import { createDashboardRouter } from "./routes/dashboard.routes";

export interface DashboardModuleDeps {
  records: EmployeeRecordsService;
  weeklyAttendance: WeeklyAttendanceService;
  sysConfig?: (key: string) => Promise<string | null>;
}

export const createDashboardModule = (deps: DashboardModuleDeps) => {
  const dashboardService = new DashboardService(prismaClient);
  const people = new PeopleDashboardService(deps.records, deps.weeklyAttendance, prismaClient, deps.sysConfig);
  const work = new WorkDashboardService(prismaClient, deps.sysConfig);
  const controller = new DashboardController(dashboardService, people, work);
  return createDashboardRouter(controller);
};

export default createDashboardModule;
