import { createApp } from "./app";
import { env as config } from "@core/config/env.config";
import { logger } from "@core/utils/logger";

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  app.listen(config.PORT, "0.0.0.0", () => {
    logger.info(`API running on port ${config.PORT} (${config.NODE_ENV})`);
  });
}