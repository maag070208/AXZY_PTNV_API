import { Router } from "express";
import authRoute from "./auth/auth.routes";
import userRoute from "./users/user.routes";
import departmentRoute from "./departments/department.routes";
import deviceTypeRoute from "./device-types/device-type.routes";
import deviceRoute from "./devices/device.routes";
import cartaRoute from "./cartas/carta.routes";
import reportRoute from "./reports/report.routes";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cartas-responsivas-api", ts: new Date().toISOString() });
});

apiRouter.use("/auth", authRoute);
apiRouter.use("/users", userRoute);
apiRouter.use("/departments", departmentRoute);
apiRouter.use("/device-types", deviceTypeRoute);
apiRouter.use("/devices", deviceRoute);
apiRouter.use("/cartas", cartaRoute);
apiRouter.use("/reports", reportRoute);

export default apiRouter;