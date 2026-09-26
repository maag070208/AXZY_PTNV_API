import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { PermissionService } from "./services/permission.service";
import { PermissionController } from "./controllers/permission.controller";
import { createPermissionsRoutes } from "./routes/permission.routes";

export { PermissionService } from "./services/permission.service";

export const createPermissionsModule = (audit?: AuditLogger) => {
  const service = new PermissionService(prismaClient, audit);
  const controller = new PermissionController(service);
  return { router: createPermissionsRoutes(controller), service };
};

export default createPermissionsModule;
