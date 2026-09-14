import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  AddUnitsInputSchema,
  DeviceBatchInputSchema,
  DeviceHistoryInputSchema,
  DeviceHistoryItemSchema,
  DeviceInputSchema,
  DeviceQueryListSchema,
  DeviceSummarySchema,
  DeviceTableResponseSchema,
  DeviceUpdateInputSchema,
  DevicesListSchema,
  LoteUpdateInputSchema,
} from "../models/dto/device.dto";
import type { DeviceController } from "../controllers/device.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const bearer = [{ bearerAuth: [] }];

export const createDevicesRouter = (controller: DeviceController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/devices",
    tags: ["Devices"],
    summary: "Listar dispositivos",
    security: bearer,
    parameters: [
      { in: "query", name: "typeId", required: false, schema: { type: "string" } },
      { in: "query", name: "estado", required: false, schema: { type: "string" } },
      { in: "query", name: "q", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Lista de dispositivos", content: { "application/json": { schema: DevicesListSchema.array() } } },
    },
  });

  registerPath({
    method: "post",
    path: "/devices/query",
    tags: ["Devices"],
    summary: "Tabla server-side de dispositivos (agrupa lotes)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: DeviceQueryListSchema } } } },
    responses: {
      200: { description: "Página de dispositivos", content: { "application/json": { schema: DeviceTableResponseSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/devices/summary",
    tags: ["Devices"],
    summary: "Resumen de conteos por estado",
    security: bearer,
    responses: {
      200: { description: "Conteos", content: { "application/json": { schema: DeviceSummarySchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/devices/availability",
    tags: ["Devices"],
    summary: "Kardex de disponibilidad: equipos por tipo con su carta vigente",
    security: bearer,
    responses: {
      200: { description: "Equipos agrupados por tipo" },
    },
  });

  registerPath({
    method: "get",
    path: "/devices/lotes/{loteId}",
    tags: ["Devices"],
    summary: "Listar unidades de un lote",
    security: bearer,
    parameters: [{ in: "path", name: "loteId", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Unidades del lote", content: { "application/json": { schema: DevicesListSchema.array() } } },
      404: { description: "Lote no encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/devices/{id}",
    tags: ["Devices"],
    summary: "Obtener dispositivo por id (con historial)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Dispositivo", content: { "application/json": { schema: DevicesListSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "get",
    path: "/devices/{id}/history",
    tags: ["Devices"],
    summary: "Historial de un dispositivo",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Historial", content: { "application/json": { schema: DeviceHistoryItemSchema.array() } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/devices/{id}/history",
    tags: ["Devices"],
    summary: "Agregar nota de historial",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DeviceHistoryInputSchema } } } },
    responses: {
      201: { description: "Nota creada", content: { "application/json": { schema: DeviceHistoryItemSchema } } },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/devices",
    tags: ["Devices"],
    summary: "Crear dispositivo (ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: DeviceInputSchema } } } },
    responses: {
      201: { description: "Creado", content: { "application/json": { schema: DevicesListSchema } } },
      400: { description: "Tipo inválido o specs inválidas" },
    },
  });

  registerPath({
    method: "post",
    path: "/devices/batch",
    tags: ["Devices"],
    summary: "Alta por lote: N unidades del mismo tipo (ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: DeviceBatchInputSchema } } } },
    responses: {
      201: { description: "Unidades creadas", content: { "application/json": { schema: DevicesListSchema.array() } } },
      400: { description: "Tipo inválido o specs inválidas" },
    },
  });

  registerPath({
    method: "post",
    path: "/devices/import/parse",
    tags: ["Devices"],
    summary: "Leer Excel de alta masiva (multipart) (ADMIN)",
    security: bearer,
    request: { body: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } } },
    responses: {
      200: { description: "Filas parseadas (no crea nada)" },
      400: { description: "Archivo inválido o faltan columnas" },
    },
  });

  registerPath({
    method: "post",
    path: "/devices/{id}/add-units",
    tags: ["Devices"],
    summary: "Agregar unidades idénticas a un dispositivo/lote (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: AddUnitsInputSchema } } } },
    responses: {
      201: { description: "Unidades agregadas" },
      404: { description: "No encontrado" },
    },
  });

  registerPath({
    method: "put",
    path: "/devices/lotes/{loteId}",
    tags: ["Devices"],
    summary: "Editar datos compartidos/unidades de un lote (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "loteId", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: LoteUpdateInputSchema } } } },
    responses: {
      200: { description: "Unidades actualizadas", content: { "application/json": { schema: DevicesListSchema.array() } } },
      400: { description: "Specs inválidas" },
      404: { description: "Lote no encontrado" },
    },
  });

  registerPath({
    method: "put",
    path: "/devices/{id}",
    tags: ["Devices"],
    summary: "Actualizar dispositivo (ADMIN)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: DeviceUpdateInputSchema } } } },
    responses: {
      200: { description: "Actualizado", content: { "application/json": { schema: DevicesListSchema } } },
      400: { description: "Tipo inválido o specs inválidas" },
      404: { description: "No encontrado" },
      409: { description: "Dispositivo asignado" },
    },
  });

  registerPath({
    method: "delete",
    path: "/devices/{id}",
    tags: ["Devices"],
    summary: "Eliminar dispositivo: soft (BAJA) → físico; force=true elimina de una vez (ADMIN)",
    security: bearer,
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "query", name: "force", required: false, schema: { type: "boolean" } },
    ],
    responses: {
      200: { description: "Eliminado (resultado soft/físico)" },
      404: { description: "No encontrado" },
      409: { description: "Dispositivo asignado" },
    },
  });

  router.use(authenticate);

  router.get("/", asyncHandler(controller.list));
  router.post("/query", asyncHandler(controller.table));
  router.get("/summary", asyncHandler(controller.summary));
  router.get("/availability", asyncHandler(controller.availability));
  router.get("/lotes/:loteId", asyncHandler(controller.getLote));
  router.get("/:id", asyncHandler(controller.getOne));
  router.get("/:id/history", asyncHandler(controller.getHistory));
  router.post("/:id/history", asyncHandler(controller.addHistory));

  router.post("/", authorize(["ADMIN"]), asyncHandler(controller.create));
  router.post("/batch", authorize(["ADMIN"]), asyncHandler(controller.createBatch));
  router.post("/import/parse", authorize(["ADMIN"]), upload.single("file"), asyncHandler(controller.parseImportFile));
  router.post("/:id/add-units", authorize(["ADMIN"]), asyncHandler(controller.addUnits));
  router.put("/lotes/:loteId", authorize(["ADMIN"]), asyncHandler(controller.updateLote));
  router.put("/:id", authorize(["ADMIN"]), asyncHandler(controller.update));
  router.delete("/:id", authorize(["ADMIN"]), asyncHandler(controller.remove));

  return router;
};