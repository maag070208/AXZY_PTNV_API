import { prismaClient } from "@core/config/database";
import type { TimezoneConfigReader } from "@core/utils/timezone";
import { ReportService } from "./services/report.service";
import { AssignmentService } from "./services/assignment.service";
import { PeriodSummaryService } from "./services/period-summary.service";
import { ReportController } from "./controllers/report.controller";
import { createReportsRouter } from "./routes/report.routes";

export interface ReportsModuleDeps {
  /** Lector de `sys_config` para la zona horaria del reporte de periodo. */
  sysConfig?: TimezoneConfigReader;
}

export const createReportsModule = ({ sysConfig }: ReportsModuleDeps = {}) => {
  const reportService = new ReportService(prismaClient);
  const assignmentService = new AssignmentService(prismaClient);
  // Misma firma que el módulo `access`: el rango del reporte se resuelve con la
  // zona de `sys_config` (ACCESS_REPORT_TIMEZONE) y no con el TZ del proceso.
  const periodSummaryService = new PeriodSummaryService(prismaClient, sysConfig);
  const controller = new ReportController(reportService, assignmentService, periodSummaryService);
  return createReportsRouter(controller);
};

export default createReportsModule;
