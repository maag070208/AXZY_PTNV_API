import { prismaClient } from "@core/config/database";
import { EmailLogService } from "./services/email-log.service";
import { EmailLogController } from "./controllers/email-log.controller";
import { createEmailLogRoutes } from "./routes/email-log.routes";

export { EmailLogService } from "./services/email-log.service";

export const createEmailModule = () => {
  const service = new EmailLogService(prismaClient);
  const controller = new EmailLogController(service);
  return { router: createEmailLogRoutes(controller), service };
};

export default createEmailModule;