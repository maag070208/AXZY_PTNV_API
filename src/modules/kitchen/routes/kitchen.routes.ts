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
  PurchaseOrderCancelDto,
  PurchaseOrderCreateDto,
  PurchaseOrderReceiveDto,
  PurchaseOrderUpdateDto,
  SupplierCreateDto,
  SupplierInvoiceCancelDto,
  SupplierInvoiceCreateDto,
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
  { method: "post", path: "/kitchen/purchase-orders/table", summary: "Purchase orders (server-side table)", body: TableQuerySchema },
  { method: "get", path: "/kitchen/purchase-orders/{id}", summary: "Purchase order detail", id: true },
  { method: "post", path: "/kitchen/purchase-orders", summary: "Create purchase order", body: PurchaseOrderCreateDto },
  { method: "patch", path: "/kitchen/purchase-orders/{id}", summary: "Update purchase order (draft)", body: PurchaseOrderUpdateDto, id: true },
  { method: "post", path: "/kitchen/purchase-orders/{id}/approve", summary: "Approve purchase order", id: true },
  { method: "post", path: "/kitchen/purchase-orders/{id}/send", summary: "Mark purchase order as sent", id: true },
  { method: "post", path: "/kitchen/purchase-orders/{id}/cancel", summary: "Cancel purchase order", body: PurchaseOrderCancelDto, id: true },
  { method: "post", path: "/kitchen/purchase-orders/{id}/receive", summary: "Receive purchase order (creates stock in)", body: PurchaseOrderReceiveDto, id: true, idem: true },
  { method: "post", path: "/kitchen/invoices/table", summary: "Supplier invoices (server-side table)", body: TableQuerySchema },
  { method: "get", path: "/kitchen/invoices/{id}", summary: "Supplier invoice detail (three-way match)", id: true },
  { method: "post", path: "/kitchen/invoices", summary: "Register supplier invoice", body: SupplierInvoiceCreateDto },
  { method: "post", path: "/kitchen/invoices/{id}/cancel", summary: "Cancel supplier invoice", body: SupplierInvoiceCancelDto, id: true },
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

  router.post("/purchase-orders/table", requiresPermission("purchase_orders.view"), asyncHandler(controller.purchaseOrdersTable));
  router.get("/purchase-orders/:id", requiresPermission("purchase_orders.view"), asyncHandler(controller.purchaseOrderDetail));
  router.post("/purchase-orders", requiresPermission("purchase_orders.create"), asyncHandler(controller.createPurchaseOrder));
  router.patch("/purchase-orders/:id", requiresPermission("purchase_orders.create"), asyncHandler(controller.updatePurchaseOrder));
  router.post("/purchase-orders/:id/approve", requiresPermission("purchase_orders.approve"), asyncHandler(controller.approvePurchaseOrder));
  router.post("/purchase-orders/:id/send", requiresPermission("purchase_orders.create"), asyncHandler(controller.sendPurchaseOrder));
  router.post("/purchase-orders/:id/cancel", requiresPermission("purchase_orders.create"), asyncHandler(controller.cancelPurchaseOrder));
  router.post("/purchase-orders/:id/receive", requiresPermission("kitchen.stock_in"), asyncHandler(controller.receivePurchaseOrder));

  router.post("/invoices/table", requiresPermission("invoices.view"), asyncHandler(controller.invoicesTable));
  router.get("/invoices/:id", requiresPermission("invoices.view"), asyncHandler(controller.invoiceDetail));
  router.post("/invoices", requiresPermission("invoices.register"), asyncHandler(controller.createInvoice));
  router.post("/invoices/:id/cancel", requiresPermission("invoices.register"), asyncHandler(controller.cancelInvoice));

  return router;
};
