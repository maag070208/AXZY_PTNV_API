import { prismaClient } from "@core/config/database";
import type { AuditPort } from "../audit/models/entity/audit.entity";
import { InventoryService } from "./services/inventory.service";
import { InventoryAuditService } from "./services/inventory-audit.service";
import { InventoryController } from "./controllers/inventory.controller";
import { createInventoryRouter } from "./routes/inventory.routes";

export const createInventoryModule = (
  auditPort: AuditPort,
  notifications: ConstructorParameters<typeof InventoryAuditService>[1]
) => {
  const service = new InventoryService(auditPort, prismaClient);
  const auditor = new InventoryAuditService(prismaClient, notifications);
  const controller = new InventoryController(service, auditor);
  return {
    router: createInventoryRouter(controller),
    service,
    /** Auditoría diaria del inventario (la arranca `index.ts`). */
    startAuditWorker: () => auditor.startDailyCheck(),
  };
};

export default createInventoryModule;