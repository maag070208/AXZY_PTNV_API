import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry";
import { env } from "@core/config/env.config";

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export const buildOpenApiDocument = () => {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Custody Letters API",
      version: "1.0.0",
      description:
        "Puerto Nuevo Custody Letters API. JWT authentication (Bearer). Roles: ADMIN, MANAGER, AREA_HEAD, EMPLOYEE, HUMAN_RESOURCES, GUARD.",
    },
    servers: [
      {
        url: `/api/v1`,
        description: env.NODE_ENV,
      },
    ],
    tags: [
      { name: "Auth", description: "Authentication and session" },
      { name: "Health", description: "Service health" },
    ],
  });
};