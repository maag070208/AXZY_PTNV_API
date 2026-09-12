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
      title: "Cartas Responsivas API",
      version: "1.0.0",
      description:
        "API de Cartas Responsivas Puerto Nuevo. Autenticación JWT (Bearer). Roles: ADMIN, GERENTE, JEFE_DE_AREA, EMPLEADO.",
    },
    servers: [
      {
        url: `/api/v1`,
        description: env.NODE_ENV,
      },
    ],
    tags: [
      { name: "Auth", description: "Autenticación y sesión" },
      { name: "Health", description: "Estado del servicio" },
    ],
  });
};