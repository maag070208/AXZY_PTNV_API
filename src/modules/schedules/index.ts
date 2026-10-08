import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { TimeClockReportService } from "@modules/time-clock/services/time-clock-report.service";
import { AccessReportService } from "@modules/access/services/access-report.service";
import { ScheduleService } from "./services/schedule.service";
import { WeeklyAttendanceService } from "./services/weekly-attendance.service";
import { PeopleAttendanceService } from "./services/people-attendance.service";
import { ScheduleController } from "./controllers/schedule.controller";
import { createSchedulesRouter } from "./routes/schedule.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface SchedulesModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createSchedulesModule = (deps: SchedulesModuleDeps = {}) => {
  // El tiempo extra se calcula con las checadas del reloj (no con la bitácora
  // del guardia). `ChecadorReportService` es stateless y barato de instanciar.
  const timeClockReport = new TimeClockReportService(prismaClient, deps.sysConfig);
  const service = new ScheduleService(prismaClient, timeClockReport, deps.sysConfig, deps.audit);
  const weeklyAttendance = new WeeklyAttendanceService(prismaClient, timeClockReport, deps.sysConfig);
  const peopleAttendance = new PeopleAttendanceService(
    { TIME_CLOCK: timeClockReport, ACCESS: new AccessReportService(prismaClient, deps.sysConfig) },
    prismaClient
  );
  const controller = new ScheduleController(service, weeklyAttendance, peopleAttendance);
  return { router: createSchedulesRouter(controller), service, weeklyAttendance };
};

export default createSchedulesModule;
