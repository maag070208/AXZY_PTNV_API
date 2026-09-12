import { prismaClient } from "@core/config/database";
import { AuthService } from "./services/auth.service";
import { AuthController } from "./controllers/auth.controller";
import { createAuthRouter } from "./routes/auth.routes";

export { AuthService } from "./services/auth.service";
export { AuthController } from "./controllers/auth.controller";
export * as authMappers from "./mappers/auth.mapper";

export const createAuthModule = () => {
  const service = new AuthService(prismaClient);
  const controller = new AuthController(service);
  return createAuthRouter(controller);
};

export default createAuthModule;