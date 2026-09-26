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
    summary: "List employees (signature picker)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "departmentId", required: false, schema: { type: "string" } },
      { in: "query", name: "roles", required: false, schema: { type: "string" } },
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Filtered employee list", content: { "application/json": { schema: UserSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/users/query",
    tags: ["Users"],
    summary: "Server-side table of users",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Page of users", content: { "application/json": { schema: UserTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/users",
    tags: ["Users"],
    summary: "List users (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "query", name: "role", required: false, schema: { type: "string" } }],
    responses: {
      200: { description: "User list", content: { "application/json": { schema: UserSchema.array() } } },
    },
  });

  registerPath({
    method: "get",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Get user (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "User", content: { "application/json": { schema: UserSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/users/{id}/history",
    tags: ["Users"],
    summary: "User activity history (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "History entries", content: { "application/json": { schema: UserHistoryEntrySchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/users",
    tags: ["Users"],
    summary: "Create user (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: UserCreateDto } } } },
    responses: {
      201: { description: "User created" },
      409: { description: "Duplicate username or employee number" },
    },
  });

  registerPath({
    method: "post",
    path: "/users/import",
    tags: ["Users"],
    summary: "Import employees from Excel (ADMIN, multipart)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
      },
    },
    responses: {
      201: { description: "Import result", content: { "application/json": { schema: UserImportResultSchema } } },
      400: { description: "Falta archivo" },
    },
  });

  registerPath({
    method: "put",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Update user (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: UserUpdateDto } } } },
    responses: {
      200: { description: "User updated" },
      409: { description: "Duplicate employee number" },
    },
  });

  registerPath({
    method: "put",
    path: "/users/{id}/password",
    tags: ["Users"],
    summary: "Change password (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: UserPasswordDto } } } },
    responses: {
      204: { description: "Password updated" },
    },
  });

  registerPath({
    method: "delete",
    path: "/users/{id}",
    tags: ["Users"],
    summary: "Delete user (ADMIN; soft → hard → forced)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "query", name: "force", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Deletion result", content: { "application/json": { schema: UserDeleteResponseSchema } } },
      400: { description: "Linked history / operation not allowed" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "patch",
    path: "/users/{id}/deactivate",
    tags: ["Users"],
    summary: "Deactivate a user (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DeactivateUserDto } } } },
    responses: {
      200: { description: "User deactivated", content: { "application/json": { schema: UserDeactivateResponseSchema } } },
      400: { description: "Operation not allowed (e.g. deactivating yourself)" },
      404: { description: "No encontrado" },
      409: { description: "Already deactivated" },
    },
  });

  registerPath({
    method: "patch",
    path: "/users/{id}/reactivate",
    tags: ["Users"],
    summary: "Reactivate a deactivated user (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "User reactivated", content: { "application/json": { schema: UserDeactivateResponseSchema } } },
      404: { description: "No encontrado" },
      409: { description: "Already active" },
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