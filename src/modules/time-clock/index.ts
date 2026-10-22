import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import type { AuditLogger } from "@modules/users/services/user.service";
import { TimeClockService } from "./services/time-clock.service";
import { TimeClockEmployeesService } from "./services/time-clock-employees.service";
import { TimeClockReportService } from "./services/time-clock-report.service";
import { TimeClockRosterService, type RosterAlerts, type UserDeactivator } from "./services/time-clock-roster.service";
import { TimeClockInspectService } from "./services/time-clock-inspect.service";
import { TimeClockPeopleService } from "./services/time-clock-people.service";
import { TimeClockSummaryService } from "./services/time-clock-summary.service";
import { TimeClockController } from "./controllers/time-clock.controller";
import { createTimeClockRouter } from "./routes/time-clock.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface TimeClockModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
  /** Da de baja a un usuario con el flujo normal (motivo y bitácora). */
  deactivateUser?: UserDeactivator;
  /** Avisos a RH del padrón (campanita y correo). */
  rosterAlerts?: RosterAlerts;
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
  const roster = new TimeClockRosterService(prismaClient, credentials, deps.audit, deps.deactivateUser, deps.rosterAlerts);
  const inspect = new TimeClockInspectService(prismaClient, credentials);
  // Escritura al reloj: solo el mock local, salvo que TIME_CLOCK_WRITE_ENABLED=true.
  const people = new TimeClockPeopleService(prismaClient, credentials, deps.audit, process.env.TIME_CLOCK_WRITE_ENABLED === "true");
  const summaryService = new TimeClockSummaryService(prismaClient, credentials);
  const controller = new TimeClockController(service, report, employees, roster, inspect, people, summaryService);
  return {
    router: createTimeClockRouter(controller),
    service,
    /** Sincronización periódica con los relojes; la arranca `src/index.ts`. */
    startWorker: () => {
      const stopSync = service.startWorker(env.TIME_CLOCK_SYNC_INTERVAL_MS);
      const stopRoster = roster.startWorker(env.TIME_CLOCK_SYNC_INTERVAL_MS);
      return () => {
        stopSync();
        stopRoster();
      };
    },
  };
};

export default createTimeClockModule;
