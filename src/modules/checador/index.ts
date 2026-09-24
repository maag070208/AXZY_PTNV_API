import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiClient } from "./services/isapi.client";
import { ChecadorService } from "./services/checador.service";
import { ChecadorEmpleadosService } from "./services/checador-empleados.service";
import { ChecadorReportService } from "./services/checador-report.service";
import { ChecadorController } from "./controllers/checador.controller";
import { createChecadorRouter } from "./routes/checador.routes";

type SysConfigReader = (key: string) => Promise<string | null>;

export interface ChecadorModuleDeps {
  audit?: AuditLogger;
  sysConfig?: SysConfigReader;
}

export const createChecadorModule = (deps: ChecadorModuleDeps = {}) => {
  // Sin CHECADOR_URL no hay cliente: la tabla responde con lo ya guardado.
  const client = env.CHECADOR_URL
    ? new IsapiClient(env.CHECADOR_URL, env.CHECADOR_USER, env.CHECADOR_PASS)
    : null;
  const service = new ChecadorService(prismaClient, client, deps.sysConfig);
  const report = new ChecadorReportService(prismaClient, deps.sysConfig);
  const empleados = new ChecadorEmpleadosService(prismaClient, deps.audit);
  const controller = new ChecadorController(service, report, empleados);
  return {
    router: createChecadorRouter(controller),
    service,
    /** Sincronización periódica con el reloj; la arranca `src/index.ts`. */
    startWorker: () => service.startWorker(env.CHECADOR_SYNC_INTERVAL_MS),
  };
};

export default createChecadorModule;
