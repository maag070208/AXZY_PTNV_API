import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { AccessReportService } from "@modules/access/services/access-report.service";
import { HorarioService } from "./services/horario.service";
import { HorarioController } from "./controllers/horario.controller";
import { createHorariosRouter } from "./routes/horario.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface HorariosModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createHorariosModule = (deps: HorariosModuleDeps = {}) => {
  const accessReport = new AccessReportService(prismaClient, deps.sysConfig);
  const service = new HorarioService(prismaClient, accessReport, deps.sysConfig, deps.audit);
  const controller = new HorarioController(service);
  return { router: createHorariosRouter(controller), service };
};

export default createHorariosModule;
