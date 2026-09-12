import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env as config } from "@core/config/env.config";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "@core/middlewares/error.middleware";
import { setupSwagger } from "@core/swagger/setup";
import apiRouter from "@modules/api.router";

export const createApp = () => {
  const app = express();

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

  setupSwagger(app);

  app.use("/api/v1", apiRouter);

  app.get("/", (_req, res) => {
    res.json({
      name: "cartas-responsivas-api",
      version: "1.0.0",
      docs: "/docs",
    });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};