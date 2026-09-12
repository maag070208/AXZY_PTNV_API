import { prismaClient } from "@core/config/database";
import { AuditService } from "./services/audit.service";
import { AuditController } from "./controllers/audit.controller";
import { createAuditRouter } from "./routes/audit.routes";

export { AuditService } from "./services/audit.service";
export type { AuditPort } from "./models/entity/audit.entity";

export const createAuditModule = () => {
  const service = new AuditService(prismaClient);
  const controller = new AuditController(service);
  return { router: createAuditRouter(controller), service };
};

export default createAuditModule;