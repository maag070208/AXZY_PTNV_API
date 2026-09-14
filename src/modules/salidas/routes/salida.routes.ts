import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  MaterialOutputBatchInputSchema,
  MaterialOutputInputSchema,
  MaterialOutputSchema,
  MaterialOutputSummarySchema,
  MaterialOutputTableResponseSchema,
  MaterialOutputUpdateInputSchema,
  SalidaQueryListSchema,
} from "../models/dto/material-output.dto";
import type { SalidaController } from "../controllers/salida.controller";

const bearer = [{ bearerAuth: [] }];

export const createSalidasRouter = (controller: SalidaController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/salidas",
    tags: ["Salidas"],
    summary: "Listar bitácora de salida de material",
    security: bearer,
    parameters: [
      { in: "query", name: "start", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "end", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "departamento", required: false, schema: { type: "string" } },
      { in: "query", name: "usuario", required: false, schema: { type: "string" } },
      { in: "query", name: "area", required: false, schema: { type: "string" } },
      { in: "query", name: "proyecto", required: false, schema: { type: "string" } },
      { in: "query", name: "motivo", required: false, schema: { type: "string", enum: ["DANADO", "OBSOLETO", "EXTRAVIO", "OTRO"] } },
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Registros", content: { "application/json": { schema: MaterialOutputSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/salidas/query",
    tags: ["Salidas"],
    summary: "Tabla server-side de salidas",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: SalidaQueryListSchema } } } },
    responses: {
      200: { description: "Página de salidas", content: { "application/json": { schema: MaterialOutputTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/salidas/suggestions",
    tags: ["Salidas"],
    summary: "Sugerencias de valores distintos por campo",
    security: bearer,
    responses: {
      200: { description: "Sugerencias", content: { "application/json": { schema: MaterialOutputSummarySchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/salidas/{id}",
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
    path: "/salidas",
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
    path: "/salidas/batch",
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
    path: "/salidas/{id}",
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
    path: "/salidas/{id}",
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

  router.post("/", asyncHandler(controller.create));
  router.post("/batch", asyncHandler(controller.createBatch));
  router.put("/:id", asyncHandler(controller.update));
  router.delete("/:id", asyncHandler(controller.remove));

  return router;
};