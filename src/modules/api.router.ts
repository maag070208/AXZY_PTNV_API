import { Router } from "express";
import { createAuthModule } from "./auth";
import { createUserModule } from "./users";
import { createDepartmentModule } from "./departments";
import {
  createDeviceTypeModule,
  formatPrefix,
  normalizeDeviceFieldConfig,
} from "./device-types";
import { createLocationModule } from "./locations";
import { createDevicesModule } from "./devices";
import { createAuditModule } from "./audit";
import { createCartaModule } from "./cartas";
import { createInventoryModule } from "./inventory";
import { createReportsModule } from "./reports";
import { createSalidasModule } from "./salidas";
import { createTicketsModule } from "./tickets";
import { createNotificationsModule } from "./notifications";
import { createDashboardModule } from "./dashboard";

const authRouter = createAuthModule();
const deviceTypeRouter = createDeviceTypeModule();
const departmentRouter = createDepartmentModule();
const locationRouter = createLocationModule();
const userRouter = createUserModule();

// Port de device-types hacia devices (DIP): devices conoce la interfaz
// DeviceTypePort, no el módulo concreto.
const deviceTypePort = { formatPrefix, normalizeDeviceFieldConfig };
const deviceRouter = createDevicesModule(deviceTypePort);
const salidaRouter = createSalidasModule();
const cartaRouter = createCartaModule();
const reportRouter = createReportsModule();

// Port de audit hacia inventory (DIP): inventory no importa audit.service.
const { router: auditRouter, service: auditService } = createAuditModule();
const inventoryRouter = createInventoryModule({ createLog: (input, client) => auditService.createLog(input, client) });

// Port de notifications hacia tickets (DIP): tickets solo conoce la interfaz.
const { router: notificationRouter, service: notificationService } = createNotificationsModule();
const ticketRouter = createTicketsModule(notificationService);
const dashboardRouter = createDashboardModule();

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cartas-responsivas-api", ts: new Date().toISOString() });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/departments", departmentRouter);
apiRouter.use("/device-types", deviceTypeRouter);
apiRouter.use("/devices", deviceRouter);
apiRouter.use("/cartas", cartaRouter);
apiRouter.use("/inventory", inventoryRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/locations", locationRouter);
apiRouter.use("/reports", reportRouter);
apiRouter.use("/salidas", salidaRouter);
apiRouter.use("/tickets", ticketRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/dashboard", dashboardRouter);

export default apiRouter;