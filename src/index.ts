import { createApp } from "./app";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";
import { prismaClient } from "@core/config/database";
import { seedPermissionsFromFixtures } from "@core/permissions";
import { startEmailWorker } from "@core/services/email-queue";
import { startTimeClockWorker, sysConfigService } from "@modules/api.router";
import {
  DEFAULT_WEEK_START_DAY,
  WEEK_START_DAY_CONFIG_KEY,
} from "@core/utils/timezone";

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    // Catálogo y matriz de permisos: la BD manda. Se siembran insert-missing
    // desde los fixtures (sin pisar ediciones) y se cargan en cache. Si falla,
    // la API arranca con catálogo/matriz vacíos: todo queda cerrado (fail-closed).
    try {
      await seedPermissionsFromFixtures(prismaClient);
    } catch (error) {
      logger.error(
        `Could not load the permission catalog/matrix; the API starts without permissions (everything 403): ${error}`
      );
    }

    // Primer día de la semana laboral (sys_config.WEEK_START_DAY): insert-missing
    // con default miércoles, para que aparezca configurable en el panel admin.
    try {
      await sysConfigService.seedFromValue(
        WEEK_START_DAY_CONFIG_KEY,
        DEFAULT_WEEK_START_DAY,
        "First day of the work week for report ranges (SUNDAY…SATURDAY)"
      );
    } catch (error) {
      logger.error(
        `Could not seed ${WEEK_START_DAY_CONFIG_KEY}; the report ranges fall back to ${DEFAULT_WEEK_START_DAY}: ${error}`
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
    startTimeClockWorker();
  })();
}