import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  DepartmentSchema,
  DepartmentCreateDto,
  DepartmentUpdateDto,
  SubareaCreateDto,
  SubareaSchema,
  DeleteResponseSchema,
  DepartmentTableResponseSchema,
  DepartmentLocationCreateDto,
  DepartmentLocationSchema,
} from "../models/dto/department.dto";
import type { DepartmentController } from "../controllers/department.controller";

export const createDepartmentRouter = (controller: DepartmentController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/departments",
    tags: ["Departments"],
    summary: "Listar departamentos",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Lista de departamentos", content: { "application/json": { schema: DepartmentSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/departments/query",
    tags: ["Departments"],
    summary: "Tabla server-side de departamentos",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Página de departamentos", content: { "application/json": { schema: DepartmentTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Obtener departamento por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Departamento", content: { "application/json": { schema: DepartmentSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/departments",
    tags: ["Departments"],
    summary: "Crear departamento (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DepartmentCreateDto } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: DepartmentSchema } } },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "put",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Actualizar departamento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DepartmentUpdateDto } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: DepartmentSchema } } },
      404: { description: "No encontrado" },
      409: { description: "Nombre duplicado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/departments/{id}",
    tags: ["Departments"],
    summary: "Eliminar departamento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/físico", content: { "application/json": { schema: DeleteResponseSchema } } },
      400: { description: "Tiene usuarios asociados" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/departments/{id}/subareas",
    tags: ["Departments"],
    summary: "Agregar subárea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SubareaCreateDto } } } },
    responses: {
      201: { description: "Subárea creada", content: { "application/json": { schema: SubareaSchema } } },
      404: { description: "Departamento inválido" },
      409: { description: "Subárea duplicada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/departments/subareas/{id}",
    tags: ["Departments"],
    summary: "Eliminar subárea (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/físico", content: { "application/json": { schema: DeleteResponseSchema } } },
      400: { description: "Tiene usuarios asociados" },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/departments/{id}/locations",
    tags: ["Departments"],
    summary: "Ligar una ubicación al departamento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DepartmentLocationCreateDto } } } },
    responses: {
      201: { description: "Ubicación ligada", content: { "application/json": { schema: DepartmentLocationSchema } } },
      404: { description: "Departamento o ubicación inválida" },
      409: { description: "Ya ligada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/departments/{id}/locations/{locationId}",
    tags: ["Departments"],
    summary: "Desligar una ubicación del departamento (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "path", name: "locationId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Ubicación desligada", content: { "application/json": { schema: DepartmentLocationSchema } } },
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

  router.post("/:id/subareas", authorize(["ADMIN"]), asyncHandler(controller.addSubarea));
  router.delete("/subareas/:id", authorize(["ADMIN"]), asyncHandler(controller.removeSubarea));

  router.post("/:id/locations", authorize(["ADMIN"]), asyncHandler(controller.addLocation));
  router.delete("/:id/locations/:locationId", authorize(["ADMIN"]), asyncHandler(controller.removeLocation));

  return router;
};