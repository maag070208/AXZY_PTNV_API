import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";
import {
  KitchenAdjustmentDto,
  KitchenCategoryCreateDto,
  KitchenCategoryUpdateDto,
  KitchenFefoPreviewDto,
  KitchenItemCreateDto,
  KitchenItemUpdateDto,
  KitchenReverseDto,
  KitchenStockInDto,
  KitchenStockOutDto,
  KitchenUnitCreateDto,
  KitchenUnitUpdateDto,
  SupplierCreateDto,
  SupplierUpdateDto,
} from "../models/dto/kitchen.dto";
import type { KitchenController } from "../controllers/kitchen.controller";

const bearer = [{ bearerAuth: [] }];
const idParam = [{ in: "path" as const, name: "id", required: true, schema: { type: "string" as const } }];
const idempotency = [{ in: "header" as const, name: "Idempotency-Key", required: false, schema: { type: "string" as const } }];
const json = (schema: unknown) => ({ body: { required: true, content: { "application/json": { schema } } } });

type Doc = { method: "get" | "post" | "patch"; path: string; summary: string; body?: unknown; id?: boolean; idem?: boolean };

const docs: Doc[] = [
  { method: "get", path: "/kitchen/categories", summary: "List kitchen categories" },
  { method: "post", path: "/kitchen/categories", summary: "Create kitchen category", body: KitchenCategoryCreateDto },
  { method: "patch", path: "/kitchen/categories/{id}", summary: "Update kitchen category", body: KitchenCategoryUpdateDto, id: true },
  { method: "get", path: "/kitchen/suppliers", summary: "List suppliers" },
  { method: "post", path: "/kitchen/suppliers", summary: "Create supplier", body: SupplierCreateDto },
  { method: "patch", path: "/kitchen/suppliers/{id}", summary: "Update supplier", body: SupplierUpdateDto, id: true },
  { method: "get", path: "/kitchen/units", summary: "List measurement units" },
  { method: "post", path: "/kitchen/units", summary: "Create measurement unit", body: KitchenUnitCreateDto },
  { method: "patch", path: "/kitchen/units/{id}", summary: "Update measurement unit", body: KitchenUnitUpdateDto, id: true },
  { method: "post", path: "/kitchen/items/table", summary: "Kitchen items with stock (server-side table)", body: TableQuerySchema },
  { method: "post", path: "/kitchen/items", summary: "Create kitchen item", body: KitchenItemCreateDto },
  { method: "get", path: "/kitchen/items/{id}", summary: "Kitchen item detail (lots, last movements)", id: true },
  { method: "patch", path: "/kitchen/items/{id}", summary: "Update kitchen item (min/max stock)", body: KitchenItemUpdateDto, id: true },
  { method: "post", path: "/kitchen/lots/table", summary: "Stock by lot (server-side table)", body: TableQuerySchema },
  { method: "post", path: "/kitchen/movements/table", summary: "Kitchen ledger (server-side table)", body: TableQuerySchema },
  { method: "get", path: "/kitchen/movements/{id}", summary: "Kitchen movement", id: true },
  { method: "post", path: "/kitchen/movements/stock-in", summary: "Register stock in (creates lots)", body: KitchenStockInDto, idem: true },
  { method: "post", path: "/kitchen/movements/stock-out", summary: "Register consumption or waste (FEFO)", body: KitchenStockOutDto, idem: true },
  { method: "post", path: "/kitchen/movements/adjustments", summary: "Physical count adjustment", body: KitchenAdjustmentDto, idem: true },
  { method: "post", path: "/kitchen/movements/fefo-preview", summary: "FEFO allocation preview (no write)", body: KitchenFefoPreviewDto },
  { method: "post", path: "/kitchen/movements/{id}/reverse", summary: "Reverse a kitchen movement", body: KitchenReverseDto, id: true, idem: true },
  { method: "get", path: "/kitchen/restock", summary: "Items below minimum with suggested quantity" },
  { method: "get", path: "/kitchen/alerts", summary: "Low/over stock, expiring and expired lots" },
];

export const createKitchenRouter = (controller: KitchenController): Router => {
  for (const d of docs) {
    registerPath({
      method: d.method,
      path: d.path,
      tags: ["Kitchen"],
      summary: d.summary,
      security: bearer,
      parameters: [...(d.id ? idParam : []), ...(d.idem ? idempotency : [])],
      ...(d.body ? { request: json(d.body) } : {}),
      responses: { 200: { description: "OK" } },
    } as Parameters<typeof registerPath>[0]);
  }

  const router = Router();
  router.use(authenticate);

  router.get("/categories", requiresPermission("kitchen.view"), asyncHandler(controller.listCategories));
  router.post("/categories", requiresPermission("kitchen.manage"), asyncHandler(controller.createCategory));
  router.patch("/categories/:id", requiresPermission("kitchen.manage"), asyncHandler(controller.updateCategory));
  router.get("/suppliers", requiresPermission("kitchen.view"), asyncHandler(controller.listSuppliers));
  router.post("/suppliers", requiresPermission("kitchen.manage"), asyncHandler(controller.createSupplier));
  router.patch("/suppliers/:id", requiresPermission("kitchen.manage"), asyncHandler(controller.updateSupplier));
  router.get("/units", requiresPermission("kitchen.view"), asyncHandler(controller.listUnits));
  router.post("/units", requiresPermission("kitchen.manage"), asyncHandler(controller.createUnit));
  router.patch("/units/:id", requiresPermission("kitchen.manage"), asyncHandler(controller.updateUnit));

  router.post("/items/table", requiresPermission("kitchen.view"), asyncHandler(controller.itemsTable));
  router.post("/items", requiresPermission("kitchen.manage"), asyncHandler(controller.createItem));
  router.get("/items/:id", requiresPermission("kitchen.view"), asyncHandler(controller.itemDetail));
  router.patch("/items/:id", requiresPermission("kitchen.manage"), asyncHandler(controller.updateItem));

  router.post("/lots/table", requiresPermission("kitchen.view"), asyncHandler(controller.lotsTable));

  router.post("/movements/table", requiresPermission("kitchen.view"), asyncHandler(controller.movementsTable));
  router.post("/movements/stock-in", requiresPermission("kitchen.stock_in"), asyncHandler(controller.stockIn));
  router.post("/movements/stock-out", requiresPermission("kitchen.stock_out"), asyncHandler(controller.stockOut));
  router.post("/movements/adjustments", requiresPermission("kitchen.adjust"), asyncHandler(controller.adjust));
  router.post("/movements/fefo-preview", requiresPermission("kitchen.stock_out"), asyncHandler(controller.fefoPreview));
  router.post("/movements/:id/reverse", requiresPermission("kitchen.adjust"), asyncHandler(controller.reverse));
  router.get("/movements/:id", requiresPermission("kitchen.view"), asyncHandler(controller.movement));

  router.get("/restock", requiresPermission("kitchen.view"), asyncHandler(controller.restock));
  router.get("/alerts", requiresPermission("kitchen.view"), asyncHandler(controller.alerts));

  return router;
};
