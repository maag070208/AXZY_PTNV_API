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
    tags: ["Permissions"],
    summary: "Catalog of active permissions",
    security: bearer,
    responses: {
      200: {
        description: "Active permissions",
        content: {
          "application/json": { schema: PermissionCatalogListSchema },
        },
      },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/admin",
    tags: ["Permissions"],
    summary: "Roles, full catalog and matrix (roles.manage)",
    security: bearer,
    responses: {
      200: {
        description: "Administration data",
        content: { "application/json": { schema: RolesAdminResponseSchema } },
      },
    },
  });

  registerPath({
    method: "put",
    path: "/permissions/matrix",
    tags: ["Permissions"],
    summary: "Update cells of the role → permission → scope matrix (roles.manage)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionMatrixUpdateSchema } } },
    },
    responses: {
      200: { description: "Matrix updated", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "Invalid changes" },
      409: { description: "Conflict (ADMIN lockout)" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/catalog",
    tags: ["Permissions"],
    summary: "Create catalog permission (roles.manage)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogCreateSchema } } },
    },
    responses: {
      201: { description: "Permission created", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Invalid body" },
      409: { description: "Duplicate key" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permissions/catalog/{key}",
    tags: ["Permissions"],
    summary: "Update catalog permission (roles.manage)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogUpdateSchema } } },
    },
    responses: {
      200: { description: "Permission updated", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Invalid body" },
      404: { description: "Permission not found" },
      409: { description: "Scopes with active grants" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/reload",
    tags: ["Permissions"],
    summary: "Reload catalog and matrix from the DB (roles.manage)",
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
