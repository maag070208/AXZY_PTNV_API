import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { ChecadorReportService } from "@modules/checador/services/checador-report.service";
import { HorarioService } from "./services/horario.service";
import { HorarioController } from "./controllers/horario.controller";
import { createHorariosRouter } from "./routes/horario.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface HorariosModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createHorariosModule = (deps: HorariosModuleDeps = {}) => {
  // El tiempo extra se calcula con las checadas del reloj (no con la bitácora
  // del guardia). `ChecadorReportService` es stateless y barato de instanciar.
  const checadorReport = new ChecadorReportService(prismaClient, deps.sysConfig);
  const service = new HorarioService(prismaClient, checadorReport, deps.sysConfig, deps.audit);
  const controller = new HorarioController(service);
  return { router: createHorariosRouter(controller), service };
};

export default createHorariosModule;
