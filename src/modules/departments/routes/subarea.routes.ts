import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
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
    summary: "Listar subáreas",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "departmentId", required: false, schema: { type: "string" } },
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Lista de subáreas", content: { "application/json": { schema: SubareaSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/subareas/query",
    tags: ["Subareas"],
    summary: "Tabla server-side de subáreas",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Página de subáreas", content: { "application/json": { schema: SubareaTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Obtener subárea por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Subárea", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/subareas",
    tags: ["Subareas"],
    summary: "Crear subárea (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: SubareaCreateDto } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "Departamento inválido" },
      409: { description: "Subárea duplicada" },
    },
  });

  registerPath({
    method: "put",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Renombrar/reactivar subárea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SubareaUpdateDto } } } },
    responses: {
      200: { description: "Actualizada", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "No encontrada" },
      409: { description: "Subárea duplicada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/subareas/{id}",
    tags: ["Subareas"],
    summary: "Eliminar subárea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/físico", content: { "application/json": { schema: DeleteResponseSchema } } },
      400: { description: "Tiene usuarios asociados" },
      404: { description: "No encontrada" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/:id", asyncHandler(controller.getOne));

  router.post("/", authorize(["ADMIN"]), asyncHandler(controller.create));
  router.put("/:id", authorize(["ADMIN"]), asyncHandler(controller.update));
  router.delete("/:id", authorize(["ADMIN"]), asyncHandler(controller.remove));

  return router;
};
