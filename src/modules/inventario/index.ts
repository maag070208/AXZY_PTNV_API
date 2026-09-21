import { prismaClient } from "@core/config/database";
import type { AuditPort } from "../audit/models/entity/audit.entity";
import { InventarioService } from "./services/inventario.service";
import { InventarioController } from "./controllers/inventario.controller";
import { createInventarioRouter } from "./routes/inventario.routes";

export const createInventarioModule = (auditPort: AuditPort) => {
  const service = new InventarioService(auditPort, prismaClient);
  const controller = new InventarioController(service);
  return createInventarioRouter(controller);
};

export default createInventarioModule;