import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { KitchenCatalogService } from "./services/kitchen-catalog.service";
import { KitchenStockService } from "./services/kitchen-stock.service";
import { KitchenAlertsService } from "./services/kitchen-alerts.service";
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
  const stock = new KitchenStockService(prismaClient, deps.sysConfig, deps.audit);
  const alerts = new KitchenAlertsService(prismaClient, stock, deps.notifications);
  return {
    router: createKitchenRouter(new KitchenController(catalog, stock)),
    stock,
    startAlertsWorker: () => alerts.startDailyCheck(),
  };
};

export default createKitchenModule;
