import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  DeviceTypeCreateDto,
  DeviceTypeUpdateDto,
  DeviceTypeSchema,
  DeviceTypeTableResponseSchema,
  NextFolioSchema,
} from "../models/dto/device-type.dto";
import type { DeviceTypeController } from "../controllers/device-type.controller";

export const createDeviceTypeRouter = (controller: DeviceTypeController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/device-types",
    tags: ["Device Types"],
    summary: "Listar tipos de dispositivo",
    security: [{ bearerAuth: [] }],
    parameters: [
      { in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Lista de tipos", content: { "application/json": { schema: DeviceTypeSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/device-types/query",
    tags: ["Device Types"],
    summary: "Tabla server-side de tipos",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: TableQuerySchema } } } },
    responses: {
      200: { description: "Página de tipos", content: { "application/json": { schema: DeviceTypeTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/device-types/{id}/peek",
    tags: ["Device Types"],
    summary: "Siguiente número de control activo",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Siguiente folio", content: { "application/json": { schema: NextFolioSchema } } },
      404: { description: "Tipo no encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/device-types/{id}/peek-carta",
    tags: ["Device Types"],
    summary: "Siguiente folio de carta",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Siguiente folio de carta", content: { "application/json": { schema: NextFolioSchema } } },
      404: { description: "Tipo no encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/device-types/{id}",
    tags: ["Device Types"],
    summary: "Obtener tipo por id",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Tipo", content: { "application/json": { schema: DeviceTypeSchema } } },
      404: { description: "Tipo no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/device-types",
    tags: ["Device Types"],
    summary: "Crear tipo (ADMIN)",
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { "application/json": { schema: DeviceTypeCreateDto } } } },
    responses: {
      201: { description: "Tipo creado", content: { "application/json": { schema: DeviceTypeSchema } } },
      400: { description: "Validación" },
      409: { description: "Code o prefix duplicado" },
    },
  });

  registerPath({
    method: "put",
    path: "/device-types/{id}",
    tags: ["Device Types"],
    summary: "Actualizar tipo (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DeviceTypeUpdateDto } } } },
    responses: {
      200: { description: "Tipo actualizado", content: { "application/json": { schema: DeviceTypeSchema } } },
      404: { description: "Tipo no encontrado" },
      409: { description: "Prefix duplicado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/device-types/{id}",
    tags: ["Device Types"],
    summary: "Desactivar tipo (ADMIN)",
    security: [{ bearerAuth: [] }],
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Tipo desactivado" },
      400: { description: "Tiene dispositivos asociados" },
    },
  });

  router.get("/", authenticate, asyncHandler(controller.list));
  router.post("/query", authenticate, asyncHandler(controller.table));
  router.get("/:id/peek", authenticate, asyncHandler(controller.peek));
  router.get("/:id/peek-carta", authenticate, asyncHandler(controller.peekCarta));
  router.get("/:id", authenticate, asyncHandler(controller.getOne));

  router.post("/", authenticate, authorize(["ADMIN"]), asyncHandler(controller.create));
  router.put("/:id", authenticate, authorize(["ADMIN"]), asyncHandler(controller.update));
  router.delete("/:id", authenticate, authorize(["ADMIN"]), asyncHandler(controller.remove));

  return router;
};