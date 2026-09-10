import { Router } from "express";
import authRoute from "./auth/auth.routes";
import userRoute from "./users/user.routes";
import departmentRoute from "./departments/department.routes";
import deviceTypeRoute from "./device-types/device-type.routes";
import deviceRoute from "./devices/device.routes";
import materialRoute from "./materials/material.routes";
import cartaRoute from "./cartas/carta.routes";
import inventoryRoute from "./inventory/inventory.routes";
import locationRoute from "./locations/location.routes";
import reportRoute from "./reports/report.routes";
import salidaRoute from "./salidas/salida.routes";
import ticketRoute from "./tickets/ticket.routes";
import notificationRoute from "./notifications/notification.routes";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cartas-responsivas-api", ts: new Date().toISOString() });
});

apiRouter.use("/auth", authRoute);
apiRouter.use("/users", userRoute);
apiRouter.use("/departments", departmentRoute);
apiRouter.use("/device-types", deviceTypeRoute);
apiRouter.use("/devices", deviceRoute);
apiRouter.use("/materials", materialRoute);
apiRouter.use("/cartas", cartaRoute);
apiRouter.use("/inventory", inventoryRoute);
apiRouter.use("/locations", locationRoute);
apiRouter.use("/reports", reportRoute);
apiRouter.use("/salidas", salidaRoute);
apiRouter.use("/tickets", ticketRoute);
apiRouter.use("/notifications", notificationRoute);

export default apiRouter;