import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  CartaCreateInputSchema,
  CartaGenerateInputSchema,
  CartaQueryListSchema,
  CartaReturnInputSchema,
  CartaSchema,
  CartaTableResponseSchema,
  CartaUpdateInputSchema,
  ConsecutivoPeekSchema,
  ConsecutivoStateSchema,
  CartaGeneratedSchema,
} from "../models/dto/carta.dto";
import type { CartaController } from "../controllers/carta.controller";

const bearer = [{ bearerAuth: [] }];

export const createCartaRouter = (controller: CartaController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/cartas",
    tags: ["Cartas"],
    summary: "Listar cartas responsivas",
    security: bearer,
    parameters: [
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Lista de cartas", content: { "application/json": { schema: CartaSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/cartas/query",
    tags: ["Cartas"],
    summary: "Tabla server-side de cartas",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: CartaQueryListSchema } } } },
    responses: {
      200: { description: "Página de cartas", content: { "application/json": { schema: CartaTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/cartas/consecutivo",
    tags: ["Cartas"],
    summary: "Estado del consecutivo (prefijo, contador, siguiente)",
    security: bearer,
    responses: {
      200: { description: "Estado", content: { "application/json": { schema: ConsecutivoStateSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/cartas/consecutivo/peek",
    tags: ["Cartas"],
    summary: "Siguiente folio sin consumirlo",
    security: bearer,
    responses: {
      200: { description: "Siguiente", content: { "application/json": { schema: ConsecutivoPeekSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/cartas/consecutivo/reset",
    tags: ["Cartas"],
    summary: "Reiniciar consecutivo (ADMIN)",
    security: bearer,
    responses: {
      200: { description: "Reiniciado" },
    },
  });

  registerPath({
    method: "post",
    path: "/cartas/generate",
    tags: ["Cartas"],
    summary: "Generar carta por tipo de dispositivo (ADMIN/GERENTE)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: CartaGenerateInputSchema } } } },
    responses: {
      201: { description: "Carta generada", content: { "application/json": { schema: CartaGeneratedSchema } } },
      404: { description: "Tipo no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/cartas",
    tags: ["Cartas"],
    summary: "Crear carta responsiva",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: CartaCreateInputSchema } } } },
    responses: {
      201: { description: "Creada", content: { "application/json": { schema: CartaSchema } } },
      400: { description: "Datos incompletos" },
      403: { description: "JEFE_DE_AREA no puede crear" },
      404: { description: "Dispositivo no encontrado" },
      409: { description: "Dispositivo ya asignado" },
    },
  });

  registerPath({
    method: "put",
    path: "/cartas/{id}",
    tags: ["Cartas"],
    summary: "Actualizar carta responsiva",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: CartaUpdateInputSchema } } } },
    responses: {
      200: { description: "Actualizada", content: { "application/json": { schema: CartaSchema } } },
      400: { description: "Datos incompletos" },
      403: { description: "No autorizado" },
      404: { description: "No encontrada" },
      409: { description: "Dispositivo ya asignado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/cartas/{id}",
    tags: ["Cartas"],
    summary: "Eliminar carta (ADMIN/GERENTE/JEFE_DE_AREA)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      204: { description: "Eliminada" },
      403: { description: "No autorizado" },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "post",
    path: "/cartas/{id}/return",
    tags: ["Cartas"],
    summary: "Registrar devolución",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: CartaReturnInputSchema } } } },
    responses: {
      200: { description: "Devuelta", content: { "application/json": { schema: CartaSchema } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "delete",
    path: "/cartas/{id}/return",
    tags: ["Cartas"],
    summary: "Deshacer devolución",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Devolución deshecha", content: { "application/json": { schema: CartaSchema } } },
      403: { description: "No autorizado" },
      404: { description: "No encontrada" },
    },
  });

  router.use(authenticate);

  router.get("/consecutivo", asyncHandler(controller.getConsecutivo));
  router.get("/consecutivo/peek", asyncHandler(controller.peek));
  router.post("/consecutivo/reset", authorize(["ADMIN"]), asyncHandler(controller.resetConsecutivoCtrl));

  router.post("/generate", authorize(["ADMIN", "GERENTE"]), asyncHandler(controller.generateCartas));

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/:id", asyncHandler(controller.getOne));
  router.post("/", asyncHandler(controller.create));
  router.put("/:id", asyncHandler(controller.update));
  router.delete("/:id", authorize(["ADMIN", "GERENTE", "JEFE_DE_AREA"]), asyncHandler(controller.remove));

  router.post("/:id/return", asyncHandler(controller.returnCarta));
  router.delete("/:id/return", asyncHandler(controller.undoReturn));

  return router;
};