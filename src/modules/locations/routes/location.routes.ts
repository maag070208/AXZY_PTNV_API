import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  LocationSchema,
  LocationCreateDto,
  LocationUpdateDto,
  DeleteSuccessSchema,
} from "../models/dto/location.dto";
import type { LocationController } from "../controllers/location.controller";

export const createLocationRouter = (controller: LocationController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/locations",
    tags: ["Locations"],
    summary: "Listar ubicaciones",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Lista de ubicaciones", content: { "application/json": { schema: LocationSchema.array() } } },
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
      200: { description: "Ubicación con dispositivos", content: { "application/json": { schema: LocationSchema } } },
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
      200: { description: "Eliminada", content: { "application/json": { schema: DeleteSuccessSchema } } },
      400: { description: "Tiene dispositivos asignados" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.getOne));
  router.post("/", authorize(["ADMIN"]), asyncHandler(controller.create));
  router.put("/:id", authorize(["ADMIN"]), asyncHandler(controller.update));
  router.delete("/:id", authorize(["ADMIN"]), asyncHandler(controller.remove));

  return router;
};