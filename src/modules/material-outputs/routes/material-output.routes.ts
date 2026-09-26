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
    tags: ["Salidas"],
    summary: "Listar bitácora de salida de material",
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
      200: { description: "Registros", content: { "application/json": { schema: MaterialOutputSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs/query",
    tags: ["Salidas"],
    summary: "Tabla server-side de salidas",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputQueryListSchema } } } },
    responses: {
      200: { description: "Página de salidas", content: { "application/json": { schema: MaterialOutputTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/material-outputs/suggestions",
    tags: ["Salidas"],
    summary: "Sugerencias de valores distintos por campo",
    security: bearer,
    responses: {
      200: { description: "Sugerencias", content: { "application/json": { schema: MaterialOutputSummarySchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/material-outputs/{id}",
    tags: ["Salidas"],
    summary: "Obtener registro de salida por id",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Registro", content: { "application/json": { schema: MaterialOutputSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs",
    tags: ["Salidas"],
    summary: "Registrar salida de material",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputInputSchema } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: MaterialOutputSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/material-outputs/batch",
    tags: ["Salidas"],
    summary: "Registrar N salidas en lote",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputBatchInputSchema } } } },
    responses: {
      201: { description: "Registros creados", content: { "application/json": { schema: MaterialOutputSchema.array() } } },
    },
  });

  registerPath({
    method: "put",
    path: "/material-outputs/{id}",
    tags: ["Salidas"],
    summary: "Actualizar registro de salida",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: MaterialOutputUpdateInputSchema } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: MaterialOutputSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/material-outputs/{id}",
    tags: ["Salidas"],
    summary: "Eliminar registro de salida",
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