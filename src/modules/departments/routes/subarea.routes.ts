import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  SubareaSchema,
  SubareaCreateDto,
  SubareaUpdateDto,
  SubareaTableResponseSchema,
  DeleteResponseSchema,
} from "../models/dto/department.dto";
import type { SubareaController } from "../controllers/subarea.controller";

export const createSubareaRouter = (controller: SubareaController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/subareas",
    tags: ["Subareas"],
    summary: "List subareas",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "departmentId", required: false, schema: { type: "string" } },
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Subarea list", content: { "application/json": { schema: SubareaSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/subareas/query",
    tags: ["Subareas"],
    summary: "Server-side table of subareas",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Page of subareas", content: { "application/json": { schema: SubareaTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Get subarea by id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Subarea", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/subareas",
    tags: ["Subareas"],
    summary: "Create subarea (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: SubareaCreateDto } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "Invalid department" },
      409: { description: "Duplicate subarea" },
    },
  });

  registerPath({
    method: "put",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Rename/reactivate subarea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SubareaUpdateDto } } } },
    responses: {
      200: { description: "Actualizada", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "No encontrada" },
      409: { description: "Duplicate subarea" },
    },
  });

  registerPath({
    method: "delete",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Delete subarea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/hard", content: { "application/json": { schema: DeleteResponseSchema } } },
      400: { description: "Has associated users" },
      404: { description: "No encontrada" },
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
