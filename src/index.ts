import { createApp } from "./app";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { startEmailWorker } from "@core/services/email-queue";
import { startChecadorWorker } from "@modules/api.router";

const app = createApp();

if (process.env.NODE_ENV !== "test") {
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
}