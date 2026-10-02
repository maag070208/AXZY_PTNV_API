import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { KitchenCatalogService } from "./services/kitchen-catalog.service";
import { KitchenStockService } from "./services/kitchen-stock.service";
import { KitchenAlertsService } from "./services/kitchen-alerts.service";
import { KitchenImportService } from "./services/kitchen-import.service";
import { PurchaseOrderService } from "./services/purchase-order.service";
import { SupplierInvoiceService } from "./services/supplier-invoice.service";
import { SupplierService } from "./services/supplier.service";
import { KitchenController } from "./controllers/kitchen.controller";
import { createKitchenRouter } from "./routes/kitchen.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface KitchenModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
  notifications: ConstructorParameters<typeof KitchenAlertsService>[2];
}

/** Almacén de cocina (KITCHEN_STORE.md): catálogo, lotes con caducidad, kardex, reabastecimiento y alertas. */
export const createKitchenModule = (deps: KitchenModuleDeps) => {
  const catalog = new KitchenCatalogService(prismaClient, deps.audit);
  const imports = new KitchenImportService(prismaClient);
  const stock = new KitchenStockService(prismaClient, deps.sysConfig, deps.audit, catalog, imports);
  const alerts = new KitchenAlertsService(prismaClient, stock, deps.notifications);
  const purchaseOrders = new PurchaseOrderService(prismaClient, stock, deps.sysConfig, deps.audit);
  const invoices = new SupplierInvoiceService(prismaClient, deps.audit);
  const suppliers = new SupplierService(prismaClient, deps.audit);
  return {
    router: createKitchenRouter(new KitchenController(catalog, stock, purchaseOrders, invoices, suppliers, imports)),
    imports,
    stock,
    purchaseOrders,
    invoices,
    startAlertsWorker: () => alerts.startDailyCheck(),
  };
};

export default createKitchenModule;
