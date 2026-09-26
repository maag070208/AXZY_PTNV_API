import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import type { AuditLogger } from "@modules/users/services/user.service";
import { TimeClockService } from "./services/time-clock.service";
import { TimeClockEmployeesService } from "./services/time-clock-employees.service";
import { TimeClockReportService } from "./services/time-clock-report.service";
import { TimeClockController } from "./controllers/time-clock.controller";
import { createTimeClockRouter } from "./routes/time-clock.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface TimeClockModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createTimeClockModule = (deps: TimeClockModuleDeps = {}) => {
  // Los relojes se dan de alta desde la web; el usuario es el mismo para todos.
  // Sin él no hay con qué conectarse: la tabla responde con lo ya guardado.
  const credentials = env.TIME_CLOCK_USER
    ? { user: env.TIME_CLOCK_USER, pass: env.TIME_CLOCK_PASS }
    : null;
  const service = new TimeClockService(prismaClient, credentials, deps.sysConfig, deps.audit);
  const report = new TimeClockReportService(prismaClient, deps.sysConfig);
  const employees = new TimeClockEmployeesService(prismaClient, deps.audit);
  const controller = new TimeClockController(service, report, employees);
  return {
    router: createTimeClockRouter(controller),
    service,
    /** Sincronización periódica con los relojes; la arranca `src/index.ts`. */
    startWorker: () => service.startWorker(env.TIME_CLOCK_SYNC_INTERVAL_MS),
  };
};

export default createTimeClockModule;
