import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { errorMiddleware } from "@core/middlewares/error.middleware";
import apiRouter from "@modules/api.router";

export const app = express();

app.use([
  cors({
    origin: config.WEB_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
  express.json({ limit: "1mb" }),
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
  }),
  morgan(config.NODE_ENV === "development" ? "dev" : "combined"),
]);

app.use("/api/v1", apiRouter);

app.get("/", (_req, res) => {
  res.json({
    name: "cartas-responsivas-api",
    version: "1.0.0",
    docs: "/api/v1/health",
  });
});

app.use(errorMiddleware);

if (process.env.NODE_ENV !== "test") {
  app.listen(config.PORT, "0.0.0.0", () => {
    logger.info(`API running on port ${config.PORT} (${config.NODE_ENV})`);
  });
}