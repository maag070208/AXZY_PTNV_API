import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  DepartmentSchema,
  DepartmentCreateDto,
  DepartmentUpdateDto,
  DeleteResponseSchema,
  DepartmentTableResponseSchema,
} from "../models/dto/department.dto";
import type { DepartmentController } from "../controllers/department.controller";

export const createDepartmentRouter = (controller: DepartmentController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/departments",
    tags: ["Departments"],
    summary: "List departments",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Department list", content: { "application/json": { schema: DepartmentSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/departments/query",
    tags: ["Departments"],
    summary: "Server-side table of departments",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Page of departments", content: { "application/json": { schema: DepartmentTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Get department by id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Department", content: { "application/json": { schema: DepartmentSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/departments",
    tags: ["Departments"],
    summary: "Create department (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DepartmentCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: DepartmentSchema } } },
      409: { description: "Duplicate name" },
    },
  });

  registerPath({
    method: "put",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Update department (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DepartmentUpdateDto } } } },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: DepartmentSchema } } },
      404: { description: "No encontrado" },
      409: { description: "Duplicate name" },
    },
  });

  registerPath({
    method: "delete",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Delete department (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/hard", content: { "application/json": { schema: DeleteResponseSchema } } },
      400: { description: "Has associated users" },
      404: { description: "No encontrado" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/:id", asyncHandler(controller.getOne));

  router.post("/", requiresPermission("departments.manage"), asyncHandler(controller.create));
  router.put("/:id", requiresPermission("departments.manage"), asyncHandler(controller.update));
  router.delete("/:id", requiresPermission("departments.manage"), asyncHandler(controller.remove));

  return router;
};
