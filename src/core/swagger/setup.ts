import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./openapi";

export const setupSwagger = (app: Express): void => {
  const document = buildOpenApiDocument();
  app.get("/docs/json", (_req, res) => res.json(document));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(document));
};