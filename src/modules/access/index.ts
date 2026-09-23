import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { AccessService, type SysConfigReader } from "./services/access.service";
import { AccessController } from "./controllers/access.controller";
import { createAccessRouter } from "./routes/access.routes";

export { AccessService, DUPLICATE_WINDOW_CONFIG_KEY } from "./services/access.service";

export interface AccessModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createAccessModule = (deps: AccessModuleDeps = {}) => {
  const service = new AccessService(prismaClient, deps.audit, deps.sysConfig);
  const controller = new AccessController(service);
  return { router: createAccessRouter(controller), service };
};

export default createAccessModule;
