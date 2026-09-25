import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { PermisoService } from "./services/permiso.service";
import { PermisoController } from "./controllers/permiso.controller";
import { createPermisosRoutes } from "./routes/permiso.routes";

export { PermisoService } from "./services/permiso.service";

export const createPermisosModule = (audit?: AuditLogger) => {
  const service = new PermisoService(prismaClient, audit);
  const controller = new PermisoController(service);
  return { router: createPermisosRoutes(controller), service };
};

export default createPermisosModule;
