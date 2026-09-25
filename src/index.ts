import { createApp } from "./app";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { prismaClient } from "@core/config/database";
import { sembrarPermisosDesdeFixtures } from "@core/permisos";
import { startEmailWorker } from "@core/services/email-queue";
import { startChecadorWorker } from "@modules/api.router";

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    // Catálogo y matriz de permisos: la BD manda. Se siembran insert-missing
    // desde los fixtures (sin pisar ediciones) y se cargan en cache. Si falla,
    // la API arranca con catálogo/matriz vacíos: todo queda cerrado (fail-closed).
    try {
      await sembrarPermisosDesdeFixtures(prismaClient);
    } catch (error) {
      logger.error(
        `No se pudo cargar el catálogo/matriz de permisos; la API arranca sin permisos (todo 403): ${error}`
      );
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