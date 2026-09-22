import { Router } from "express";
import { createAuthModule } from "./auth";
import { createUserModule } from "./users";
import { createDepartmentModule } from "./departments";
import { createAuditModule } from "./audit";
import { createInventarioModule } from "./inventario";
import { createReportsModule } from "./reports";
import { createSalidasModule } from "./salidas";
import { createTicketsModule } from "./tickets";
import { createNotificationsModule } from "./notifications";
import { createDashboardModule } from "./dashboard";
import { createPersonalModule } from "./personal";

const authRouter = createAuthModule();
const { departmentRouter, subareaRouter } = createDepartmentModule();

// Port de audit hacia inventario y usuarios (DIP).
const { router: auditRouter, service: auditService } = createAuditModule();
const auditPort = {
  createLog: (input: unknown, client?: unknown) =>
    auditService.createLog(
      input as Parameters<typeof auditService.createLog>[0],
      client as Parameters<typeof auditService.createLog>[1]
    ),
};
const userRouter = createUserModule(auditPort.createLog);
const salidaRouter = createSalidasModule();
const reportRouter = createReportsModule();
const inventarioRouter = createInventarioModule(auditPort as never);

// Port de notifications hacia tickets (DIP).
const { router: notificationRouter, service: notificationService } = createNotificationsModule();
const ticketRouter = createTicketsModule(notificationService);
const dashboardRouter = createDashboardModule();
const personalRouter = createPersonalModule();

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cartas-responsivas-api", ts: new Date().toISOString() });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/departments", departmentRouter);
apiRouter.use("/subareas", subareaRouter);
apiRouter.use("/inventario", inventarioRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/reports", reportRouter);
apiRouter.use("/salidas", salidaRouter);
apiRouter.use("/tickets", ticketRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/personal", personalRouter);

export default apiRouter;