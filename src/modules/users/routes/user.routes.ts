import { Router } from "express";
import multer from "multer";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  UserSchema,
  UserCreateDto,
  UserUpdateDto,
  UserPasswordDto,
  UserTableResponseSchema,
  UserImportResultSchema,
  UserHistoryEntrySchema,
  UserDeleteResponseSchema,
  DeactivateUserDto,
  UserDeactivateResponseSchema,
} from "../models/dto/user.dto";
import type { UserController } from "../controllers/user.controller";

export const createUserRouter = (controller: UserController): Router => {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  registerPath({
    method: "get",
    path: "/users/employees",
    tags: ["Users"],
    summary: "Listar empleados (selector de firmas)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "departmentId", required: false, schema: { type: "string" } },
      { in: "query", name: "roles", required: false, schema: { type: "string" } },
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Lista filtrada de empleados", content: { "application/json": { schema: UserSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/users/query",
    tags: ["Users"],
    summary: "Tabla server-side de usuarios",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Página de usuarios", content: { "application/json": { schema: UserTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/users",
    tags: ["Users"],
    summary: "Listar usuarios (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "role", required: false, schema: { type: "string" } }],
    responses: {
      200: { description: "Lista de usuarios", content: { "application/json": { schema: UserSchema.array() } } },
    },
  });

  registerPath({
    method: "get",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Obtener usuario (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Usuario", content: { "application/json": { schema: UserSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/users/{id}/history",
    tags: ["Users"],
    summary: "Historial de actividad del usuario (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Entradas de historial", content: { "application/json": { schema: UserHistoryEntrySchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/users",
    tags: ["Users"],
    summary: "Crear usuario (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: UserCreateDto } } } },
    responses: {
      201: { description: "Usuario creado" },
      409: { description: "Username o número de empleado duplicado" },
    },
  });

  registerPath({
    method: "post",
    path: "/users/import",
    tags: ["Users"],
    summary: "Importar empleados desde Excel (ADMIN, multipart)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
      },
    },
    responses: {
      201: { description: "Resultado de importación", content: { "application/json": { schema: UserImportResultSchema } } },
      400: { description: "Falta archivo" },
    },
  });

  registerPath({
    method: "put",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Actualizar usuario (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: UserUpdateDto } } } },
    responses: {
      200: { description: "Usuario actualizado" },
      409: { description: "Número de empleado duplicado" },
    },
  });

  registerPath({
    method: "put",
    path: "/users/{id}/password",
    tags: ["Users"],
    summary: "Cambiar contraseña (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: UserPasswordDto } } } },
    responses: {
      204: { description: "Contraseña actualizada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Eliminar usuario (ADMIN; soft → físico → forzado)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "query", name: "force", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Resultado de eliminación", content: { "application/json": { schema: UserDeleteResponseSchema } } },
      400: { description: "Historial ligado / impide operación" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/users/{id}/deactivate",
    tags: ["Users"],
    summary: "Dar de baja a un usuario (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DeactivateUserDto } } } },
    responses: {
      200: { description: "Usuario dado de baja", content: { "application/json": { schema: UserDeactivateResponseSchema } } },
      400: { description: "Operación no permitida (p.ej. darse de baja a sí mismo)" },
      404: { description: "No encontrado" },
      409: { description: "Ya estaba dado de baja" },
    },
  });

  registerPath({
    method: "patch",
    path: "/users/{id}/reactivate",
    tags: ["Users"],
    summary: "Reactivar un usuario dado de baja (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Usuario reactivado", content: { "application/json": { schema: UserDeactivateResponseSchema } } },
      404: { description: "No encontrado" },
      409: { description: "Ya estaba activo" },
    },
  });

  router.use(authenticate);

  // USER y ADMIN pueden listar EMPLEADO (selector de firmas)
  router.get("/employees", asyncHandler(controller.listEmployees));
  router.post("/query", asyncHandler(controller.table));

  router.get("/", requiresPermission("users.view"), asyncHandler(controller.list));
  router.get("/:id", requiresPermission("users.view"), asyncHandler(controller.getById));
  router.get("/:id/history", requiresPermission("users.view"), asyncHandler(controller.history));
  router.post("/", requiresPermission("users.create"), asyncHandler(controller.create));
  router.post("/import", requiresPermission("users.create"), upload.single("file"), asyncHandler(controller.importUsers));
  router.put("/:id", requiresPermission("users.edit"), asyncHandler(controller.update));
  router.put("/:id/password", requiresPermission("users.edit"), asyncHandler(controller.changePassword));
  router.patch("/:id/deactivate", requiresPermission("users.edit"), asyncHandler(controller.deactivate));
  router.patch("/:id/reactivate", requiresPermission("users.edit"), asyncHandler(controller.reactivate));
  router.delete("/:id", requiresPermission("users.delete"), asyncHandler(controller.remove));

  return router;
};