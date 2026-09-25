import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  PermisoCatalogoCreateSchema,
  PermisoCatalogoListSchema,
  PermisoCatalogoSchema,
  PermisoCatalogoUpdateSchema,
  PermisoMatrizUpdateSchema,
  RolesAdminResponseSchema,
} from "../models/dto/permiso.dto";
import type { PermisoController } from "../controllers/permiso.controller";

const bearer = [{ bearerAuth: [] }];

export const createPermisosRoutes = (controller: PermisoController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/permisos/catalogo",
    tags: ["Permisos"],
    summary: "Catálogo de permisos activos",
    security: bearer,
    responses: {
      200: {
        description: "Permisos activos",
        content: {
          "application/json": { schema: PermisoCatalogoListSchema },
        },
      },
    },
  });

  registerPath({
    method: "get",
    path: "/permisos/admin",
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
    path: "/permisos/matriz",
    tags: ["Permisos"],
    summary: "Actualizar celdas de la matriz rol → permiso → alcance (roles.administrar)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermisoMatrizUpdateSchema } } },
    },
    responses: {
      200: { description: "Matriz actualizada", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "Cambios inválidos" },
      409: { description: "Conflicto (lockout de ADMIN)" },
    },
  });

  registerPath({
    method: "post",
    path: "/permisos/catalogo",
    tags: ["Permisos"],
    summary: "Crear permiso del catálogo (roles.administrar)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermisoCatalogoCreateSchema } } },
    },
    responses: {
      201: { description: "Permiso creado", content: { "application/json": { schema: PermisoCatalogoSchema } } },
      400: { description: "Body inválido" },
      409: { description: "Clave duplicada" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permisos/catalogo/{clave}",
    tags: ["Permisos"],
    summary: "Actualizar permiso del catálogo (roles.administrar)",
    security: bearer,
    parameters: [
      { in: "path", name: "clave", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { required: true, content: { "application/json": { schema: PermisoCatalogoUpdateSchema } } },
    },
    responses: {
      200: { description: "Permiso actualizado", content: { "application/json": { schema: PermisoCatalogoSchema } } },
      400: { description: "Body inválido" },
      404: { description: "Permiso no encontrado" },
      409: { description: "Alcances con concesiones activas" },
    },
  });

  registerPath({
    method: "post",
    path: "/permisos/reload",
    tags: ["Permisos"],
    summary: "Recargar catálogo y matriz desde la BD (roles.administrar)",
    security: bearer,
    responses: {
      200: { description: "Caches recargadas", content: { "application/json": { schema: { type: "object" } } } },
    },
  });

  router.use(authenticate);

  // Catálogo activo: solo requiere sesión, la web lo usa para mostrar nombres.
  router.get("/catalogo", asyncHandler(controller.catalogo));

  router.get("/admin", requierePermiso("roles.administrar"), asyncHandler(controller.admin));
  router.put("/matriz", requierePermiso("roles.administrar"), asyncHandler(controller.matriz));
  router.post("/catalogo", requierePermiso("roles.administrar"), asyncHandler(controller.create));
  router.patch(
    "/catalogo/:clave",
    requierePermiso("roles.administrar"),
    asyncHandler(controller.update)
  );
  router.post("/reload", requierePermiso("roles.administrar"), asyncHandler(controller.reload));

  return router;
};
