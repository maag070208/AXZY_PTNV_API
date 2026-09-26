import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  PermissionCatalogCreateSchema,
  PermissionCatalogListSchema,
  PermissionCatalogSchema,
  PermissionCatalogUpdateSchema,
  PermissionMatrixUpdateSchema,
  RolesAdminResponseSchema,
} from "../models/dto/permission.dto";
import type { PermissionController } from "../controllers/permission.controller";

const bearer = [{ bearerAuth: [] }];

export const createPermissionsRoutes = (controller: PermissionController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/permissions/catalog",
    tags: ["Permisos"],
    summary: "Catálogo de permisos activos",
    security: bearer,
    responses: {
      200: {
        description: "Permisos activos",
        content: {
          "application/json": { schema: PermissionCatalogListSchema },
        },
      },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/admin",
    tags: ["Permisos"],
    summary: "Roles, catálogo completo y matriz (roles.administrar)",
    security: bearer,
    responses: {
      200: {
        description: "Datos de administración",
        content: { "application/json": { schema: RolesAdminResponseSchema } },
      },
    },
  });

  registerPath({
    method: "put",
    path: "/permissions/matrix",
    tags: ["Permisos"],
    summary: "Actualizar celdas de la matriz rol → permiso → alcance (roles.administrar)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionMatrixUpdateSchema } } },
    },
    responses: {
      200: { description: "Matriz actualizada", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "Cambios inválidos" },
      409: { description: "Conflicto (lockout de ADMIN)" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/catalog",
    tags: ["Permisos"],
    summary: "Crear permiso del catálogo (roles.administrar)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogCreateSchema } } },
    },
    responses: {
      201: { description: "Permiso creado", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Body inválido" },
      409: { description: "Clave duplicada" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permissions/catalog/{key}",
    tags: ["Permisos"],
    summary: "Actualizar permiso del catálogo (roles.administrar)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogUpdateSchema } } },
    },
    responses: {
      200: { description: "Permiso actualizado", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Body inválido" },
      404: { description: "Permiso no encontrado" },
      409: { description: "Alcances con concesiones activas" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/reload",
    tags: ["Permisos"],
    summary: "Recargar catálogo y matriz desde la BD (roles.administrar)",
    security: bearer,
    responses: {
      200: { description: "Caches recargadas", content: { "application/json": { schema: { type: "object" } } } },
    },
  });

  router.use(authenticate);

  // Catálogo activo: solo requiere sesión, la web lo usa para mostrar nombres.
  router.get("/catalog", asyncHandler(controller.catalog));

  router.get("/admin", requiresPermission("roles.manage"), asyncHandler(controller.admin));
  router.put("/matrix", requiresPermission("roles.manage"), asyncHandler(controller.matrix));
  router.post("/catalog", requiresPermission("roles.manage"), asyncHandler(controller.create));
  router.patch(
    "/catalog/:key",
    requiresPermission("roles.manage"),
    asyncHandler(controller.update)
  );
  router.post("/reload", requiresPermission("roles.manage"), asyncHandler(controller.reload));

  return router;
};
