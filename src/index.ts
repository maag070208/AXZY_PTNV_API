import { createApp } from "./app";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { prismaClient } from "@core/config/database";
import { cargarMatrizDesdeDb, sembrarMatrizPorDefecto } from "@core/permisos";
import { startEmailWorker } from "@core/services/email-queue";
import { startChecadorWorker } from "@modules/api.router";

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    // Matriz rol → permiso → alcance: la BD manda. Se siembra insert-missing
    // (sin pisar ediciones) y se carga en cache. Si falla, el resolvedor cae a
    // `ROLES_BASE` y el arranque continúa.
    try {
      await sembrarMatrizPorDefecto(prismaClient);
      await cargarMatrizDesdeDb(prismaClient);
    } catch (error) {
      logger.error(`No se pudo cargar la matriz de permisos; se usan los defaults: ${error}`);
    }

    app.listen(config.PORT, "0.0.0.0", () => {
      logger.info(`API running on port ${config.PORT} (${config.NODE_ENV})`);
    });
    // Worker de correo en el mismo proceso: drena la cola PENDING + reintentos
    // con backoff. En E2E se omite (NODE_ENV=test) para no disparar envíos.
    startEmailWorker();
    // Sincronización periódica con los relojes checadores dados de alta (solo lee
    // de los equipos; sin CHECADOR_USER no arranca). La primera corrida de cada
    // reloj trae su historial completo.
    startChecadorWorker();
  })();
}