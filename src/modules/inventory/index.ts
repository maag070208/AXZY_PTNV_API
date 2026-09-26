import { prismaClient } from "@core/config/database";
import type { AuditPort } from "../audit/models/entity/audit.entity";
import { InventoryService } from "./services/inventory.service";
import { InventoryController } from "./controllers/inventory.controller";
import { createInventoryRouter } from "./routes/inventory.routes";

export const createInventoryModule = (auditPort: AuditPort) => {
  const service = new InventoryService(auditPort, prismaClient);
  const controller = new InventoryController(service);
  return createInventoryRouter(controller);
};

export default createInventoryModule;