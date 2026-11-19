import { prismaClient } from "@core/config/database";
import { UserService, type AuditLogger } from "./services/user.service";
import { UserHistoryService } from "./services/user-history.service";
import { UserImportService } from "./services/user-import.service";
import { UserPermissionsService } from "./services/user-permissions.service";
import {
  EmployeeSyncService,
  type EmployeeSyncClockPort,
  type EmployeeSyncSchedulePort,
} from "./services/employee-sync.service";
import { UserController } from "./controllers/user.controller";
import { EmployeeSyncController } from "./controllers/employee-sync.controller";
import { createUserRouter } from "./routes/user.routes";
import { createEmployeeSyncRouter } from "./routes/employee-sync.routes";
import type { NotificationPort } from "@modules/notifications";

export { UserService } from "./services/user.service";
export type { AuditLogger } from "./services/user.service";
export { UserHistoryService } from "./services/user-history.service";
export { UserImportService } from "./services/user-import.service";
export { UserPermissionsService } from "./services/user-permissions.service";
export { EmployeeSyncService } from "./services/employee-sync.service";
export type {
  EmployeeSyncClockPort,
  EmployeeSyncSchedulePort,
} from "./services/employee-sync.service";

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

/** Dependencias de la sincronización de empleados (solo operaciones, no módulos). */
export interface EmployeeSyncModuleDeps {
  /** Servicio de usuarios ya creado: las bajas reutilizan `deactivateInTx`. */
  users: UserService;
  audit?: AuditLogger;
  /** Asignación de horarios (después del commit). */
  schedules?: EmployeeSyncSchedulePort;
  /** Padrón del reloj (alta/baja de la persona). */
  clock?: EmployeeSyncClockPort;
}

/**
 * Sincronización de empleados desde el Excel oficial de nómina. Devuelve un
 * router propio que se monta en `/users` (sus rutas `POST /sync/...` no
 * colisionan con el CRUD del `userRouter`).
 */
export const createEmployeeSyncModule = (deps: EmployeeSyncModuleDeps) => {
  const service = new EmployeeSyncService(prismaClient, deps.users, deps.audit, {
    schedules: deps.schedules,
    clock: deps.clock,
  });
  const controller = new EmployeeSyncController(service);
  return createEmployeeSyncRouter(controller);
};
