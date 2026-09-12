import { prismaClient } from "@core/config/database";
import { NotificationService } from "./services/notification.service";
import { NotificationController } from "./controllers/notification.controller";
import { createNotificationsRouter } from "./routes/notification.routes";

export { NotificationService } from "./services/notification.service";
export type {
  NotificationPort,
  CreateNotificationInput,
} from "./models/entity/notification.entity";

export const createNotificationsModule = () => {
  const service = new NotificationService(prismaClient);
  const controller = new NotificationController(service);
  return { router: createNotificationsRouter(controller), service };
};

export default createNotificationsModule;