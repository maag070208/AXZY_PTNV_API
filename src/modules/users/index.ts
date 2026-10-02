import { prismaClient } from "@core/config/database";
import { UserService, type AuditLogger } from "./services/user.service";
import { UserHistoryService } from "./services/user-history.service";
import { UserImportService } from "./services/user-import.service";
import { UserPermissionsService } from "./services/user-permissions.service";
import { UserController } from "./controllers/user.controller";
import { createUserRouter } from "./routes/user.routes";
import type { NotificationPort } from "@modules/notifications";

export { UserService } from "./services/user.service";
export type { AuditLogger } from "./services/user.service";
export { UserHistoryService } from "./services/user-history.service";
export { UserImportService } from "./services/user-import.service";
export { UserPermissionsService } from "./services/user-permissions.service";

/**
 * @param audit Puerto de auditoría opcional (DIP). Si se inyecta, las bajas
 * y reactivaciones se registran en la misma transacción que el cambio.
 * @param notifications Puerto de notificaciones opcional (DIP). Si se inyecta,
 * altas, bajas y carga de documentos disparan notificaciones in-app a
 * admin/HR además del correo al destinatario directo.
 */
export const createUserModule = (
  audit?: AuditLogger,
  notifications?: NotificationPort
) => {
  const users = new UserService(prismaClient, audit, notifications);
  const historyService = new UserHistoryService(prismaClient);
  const importService = new UserImportService(prismaClient);
  const permissions = new UserPermissionsService(prismaClient, audit);
  const controller = new UserController(users, historyService, importService, permissions);
  return createUserRouter(controller);
};

export default createUserModule;