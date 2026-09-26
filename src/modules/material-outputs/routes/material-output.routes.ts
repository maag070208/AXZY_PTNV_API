import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  MaterialOutputBatchInputSchema,
  MaterialOutputInputSchema,
  MaterialOutputSchema,
  MaterialOutputSummarySchema,
  MaterialOutputTableResponseSchema,
  MaterialOutputUpdateInputSchema,
  MaterialOutputQueryListSchema,
} from "../models/dto/material-output.dto";
import type { MaterialOutputController } from "../controllers/material-output.controller";

const bearer = [{ bearerAuth: [] }];

export const createMaterialOutputsRouter = (controller: MaterialOutputController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/material-outputs",
    tags: ["Material outputs"],
    summary: "List the material output log",
    security: bearer,
    parameters: [
      { in: "query", name: "start", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "end", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "departmentName", required: false, schema: { type: "string" } },
      { in: "query", name: "userName", required: false, schema: { type: "string" } },
      { in: "query", name: "area", required: false, schema: { type: "string" } },
      { in: "query", name: "project", required: false, schema: { type: "string" } },
      { in: "query", name: "reason", required: false, schema: { type: "string", enum: ["DAMAGED", "OBSOLETE", "LOST", "OTHER"] } },
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Records", content: { "application/json": { schema: MaterialOutputSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs/query",
    tags: ["Material outputs"],
    summary: "Server-side table of material outputs",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputQueryListSchema } } } },
    responses: {
      200: { description: "Page of material outputs", content: { "application/json": { schema: MaterialOutputTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/material-outputs/suggestions",
    tags: ["Material outputs"],
    summary: "Distinct value suggestions per field",
    security: bearer,
    responses: {
      200: { description: "Sugerencias", content: { "application/json": { schema: MaterialOutputSummarySchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/material-outputs/{id}",
    tags: ["Material outputs"],
    summary: "Get material output record by id",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Record", content: { "application/json": { schema: MaterialOutputSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs",
    tags: ["Material outputs"],
    summary: "Register a material output",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputInputSchema } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: MaterialOutputSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs/batch",
    tags: ["Material outputs"],
    summary: "Register N material outputs in batch",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputBatchInputSchema } } } },
    responses: {
      201: { description: "Records created", content: { "application/json": { schema: MaterialOutputSchema.array() } } },
    },
  });

  registerPath({
    method: "put",
    path: "/material-outputs/{id}",
    tags: ["Material outputs"],
    summary: "Update material output record",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputUpdateInputSchema } } } },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: MaterialOutputSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/material-outputs/{id}",
    tags: ["Material outputs"],
    summary: "Delete material output record",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Eliminado", content: { "application/json": { schema: MaterialOutputSchema } } },
      404: { description: "No encontrado" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/suggestions", asyncHandler(controller.suggestions));
  router.get("/:id", asyncHandler(controller.getOne));

  router.post("/", requiresPermission("material_outputs.register"), asyncHandler(controller.create));
  router.post("/batch", requiresPermission("material_outputs.register"), asyncHandler(controller.createBatch));
  router.put("/:id", requiresPermission("material_outputs.register"), asyncHandler(controller.update));
  router.delete("/:id", requiresPermission("material_outputs.register"), asyncHandler(controller.remove));

  return router;
};