import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  LocationSchema,
  LocationCreateDto,
  LocationUpdateDto,
  SublugarSchema,
  SublugarCreateDto,
  DeleteLocationResponseSchema,
  LocationTableResponseSchema,
} from "../models/dto/location.dto";
import type { LocationController } from "../controllers/location.controller";

export const createLocationRouter = (controller: LocationController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/locations",
    tags: ["Locations"],
    summary: "Listar ubicaciones (con sub-áreas activas)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Lista de ubicaciones", content: { "application/json": { schema: LocationSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/locations/query",
    tags: ["Locations"],
    summary: "Listar ubicaciones (server-side, tabla)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Paginada", content: { "application/json": { schema: LocationTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/locations/{id}",
    tags: ["Locations"],
    summary: "Obtener ubicación por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Ubicación con sub-áreas", content: { "application/json": { schema: LocationSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/locations",
    tags: ["Locations"],
    summary: "Crear ubicación (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: LocationCreateDto } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: LocationSchema } } },
      409: { description: "Lugar duplicado" },
    },
  });

  registerPath({
    method: "put",
    path: "/locations/{id}",
    tags: ["Locations"],
    summary: "Actualizar ubicación (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: LocationUpdateDto } } } },
    responses: {
      200: { description: "Actualizada", content: { "application/json": { schema: LocationSchema } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/locations/{id}",
    tags: ["Locations"],
    summary: "Eliminar ubicación (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/físico", content: { "application/json": { schema: DeleteLocationResponseSchema } } },
      400: { description: "Tiene dispositivos/cartas/movimientos" },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/locations/{id}/sublugares",
    tags: ["Locations"],
    summary: "Agregar sub-área (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: SublugarCreateDto } } } },
    responses: {
      201: { description: "Sub-área creada", content: { "application/json": { schema: SublugarSchema } } },
      404: { description: "Ubicación inválida" },
      409: { description: "Sub-área duplicada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/locations/sublugares/{id}",
    tags: ["Locations"],
    summary: "Eliminar sub-área (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Soft/físico", content: { "application/json": { schema: DeleteLocationResponseSchema } } },
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

  router.post("/:id/sublugares", authorize(["ADMIN"]), asyncHandler(controller.addSublugar));
  router.delete("/sublugares/:id", authorize(["ADMIN"]), asyncHandler(controller.removeSublugar));

  return router;
};