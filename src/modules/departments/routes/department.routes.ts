import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
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

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/:id", asyncHandler(controller.getOne));

  router.post("/", requierePermiso("departamentos.administrar"), asyncHandler(controller.create));
  router.put("/:id", requierePermiso("departamentos.administrar"), asyncHandler(controller.update));
  router.delete("/:id", requierePermiso("departamentos.administrar"), asyncHandler(controller.remove));

  return router;
};
