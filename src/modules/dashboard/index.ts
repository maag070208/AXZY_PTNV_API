import { prismaClient } from "@core/config/database";
import { DashboardService } from "./services/dashboard.service";
import { DashboardController } from "./controllers/dashboard.controller";
import { createDashboardRouter } from "./routes/dashboard.routes";

export const createDashboardModule = () => {
  const dashboardService = new DashboardService(prismaClient);
  const controller = new DashboardController(dashboardService);
  return createDashboardRouter(controller);
};

export default createDashboardModule;
