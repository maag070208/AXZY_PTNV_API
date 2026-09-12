import { prismaClient } from "@core/config/database";
import { UserService } from "./services/user.service";
import { UserHistoryService } from "./services/user-history.service";
import { UserImportService } from "./services/user-import.service";
import { UserController } from "./controllers/user.controller";
import { createUserRouter } from "./routes/user.routes";

export { UserService } from "./services/user.service";
export { UserHistoryService } from "./services/user-history.service";
export { UserImportService } from "./services/user-import.service";

export const createUserModule = () => {
  const users = new UserService(prismaClient);
  const historyService = new UserHistoryService(prismaClient);
  const importService = new UserImportService(prismaClient);
  const controller = new UserController(users, historyService, importService);
  return createUserRouter(controller);
};

export default createUserModule;