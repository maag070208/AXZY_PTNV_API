import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  InventorySummarySchema,
  KardexSchema,
  MovementInputSchema,
  MovementSchema,
} from "../models/dto/inventory.dto";
import type { InventoryController } from "../controllers/inventory.controller";

const bearer = [{ bearerAuth: [] }];

export const createInventoryRouter = (controller: InventoryController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/inventory/movements",
    tags: ["Inventory"],
    summary: "Listar movimientos de inventario",
    security: bearer,
    parameters: [
      { in: "query", name: "deviceId", required: false, schema: { type: "string" } },
      { in: "query", name: "locationId", required: false, schema: { type: "string" } },
      { in: "query", name: "start", required: false, schema: { type: "string", format: "date" } },
      { in: "query", name: "end", required: false, schema: { type: "string", format: "date" } },
    ],
    responses: {
      200: { description: "Movimientos", content: { "application/json": { schema: MovementSchema.array() } } },
    },
  });

  registerPath({
    method: "get",
    path: "/inventory/kardex/{deviceId}",
    tags: ["Inventory"],
    summary: "Kardex de un dispositivo",
    security: bearer,
    parameters: [{ in: "path", name: "deviceId", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Dispositivo + movimientos", content: { "application/json": { schema: KardexSchema } } },
      404: { description: "Dispositivo no encontrado" },
    },
  });

  registerPath({
    method: "post",
    path: "/inventory/movements",
    tags: ["Inventory"],
    summary: "Registrar movimiento (ADMIN/GERENTE/JEFE_DE_AREA)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: MovementInputSchema } } } },
    responses: {
      201: { description: "Movimiento registrado", content: { "application/json": { schema: MovementSchema } } },
      400: { description: "Ubicación requerida o user id" },
      404: { description: "Dispositivo no encontrado" },
      409: { description: "Dispositivo dado de baja" },
    },
  });

  registerPath({
    method: "get",
    path: "/inventory/summary",
    tags: ["Inventory"],
    summary: "Resumen de inventario por ubicación",
    security: bearer,
    responses: {
      200: { description: "Resumen", content: { "application/json": { schema: InventorySummarySchema } } },
    },
  });

  router.use(authenticate);

  router.get("/movements", asyncHandler(controller.list));
  router.get("/kardex/:deviceId", asyncHandler(controller.getKardex));
  router.post("/movements", authorize(["ADMIN", "GERENTE", "JEFE_DE_AREA"]), asyncHandler(controller.registerMovement));
  router.post("/movements/query", asyncHandler(controller.movTable));
  router.get("/summary", asyncHandler(controller.summary));

  return router;
};