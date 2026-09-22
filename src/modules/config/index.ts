import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { SysConfigService } from "./services/sys-config.service";
import { SysConfigController } from "./controllers/sys-config.controller";
import { createConfigRoutes } from "./routes/config.routes";

export { SysConfigService } from "./services/sys-config.service";

export const createConfigModule = (audit?: AuditLogger) => {
  const service = new SysConfigService(prismaClient, audit);
  const controller = new SysConfigController(service);
  return { router: createConfigRoutes(controller), service };
};

export default createConfigModule;