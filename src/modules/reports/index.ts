import { prismaClient } from "@core/config/database";
import { ReportService } from "./services/report.service";
import { AssignmentService } from "./services/assignment.service";
import { ReportController } from "./controllers/report.controller";
import { createReportsRouter } from "./routes/report.routes";

export const createReportsModule = () => {
  const reportService = new ReportService(prismaClient);
  const assignmentService = new AssignmentService(prismaClient);
  const controller = new ReportController(reportService, assignmentService);
  return createReportsRouter(controller);
};

export default createReportsModule;