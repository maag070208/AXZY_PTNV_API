import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { PermissionService } from "./services/permission.service";
import { PolicyService } from "./services/policy.service";
import { AccessService } from "./services/access.service";
import { PermissionController } from "./controllers/permission.controller";
import { createPermissionsRoutes } from "./routes/permission.routes";

export { PermissionService } from "./services/permission.service";
export { PolicyService } from "./services/policy.service";

export const createPermissionsModule = (audit?: AuditLogger) => {
  const service = new PermissionService(prismaClient, audit);
  const policyService = new PolicyService(prismaClient, audit);
  const accessService = new AccessService(prismaClient, audit);
  const controller = new PermissionController(service, policyService, accessService);
  return { router: createPermissionsRoutes(controller), service, policyService };
};

export default createPermissionsModule;
