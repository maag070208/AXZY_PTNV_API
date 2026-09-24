import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { OvertimeService, type OvertimeCalculator } from "./services/overtime.service";
import { OvertimeController } from "./controllers/overtime.controller";
import { createOvertimeRouter } from "./routes/overtime.routes";

export interface OvertimeModuleDeps {
  /** Puerto de cálculo (lo implementa `HorarioService`). Dirección `overtime → horarios`. */
  calculator: OvertimeCalculator;
  audit?: AuditLogger;
}

export const createOvertimeModule = (deps: OvertimeModuleDeps) => {
  const service = new OvertimeService(prismaClient, deps.calculator, deps.audit);
  const controller = new OvertimeController(service);
  return { router: createOvertimeRouter(controller), service };
};

export default createOvertimeModule;
