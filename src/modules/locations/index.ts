import { prismaClient } from "@core/config/database";
import { LocationService } from "./services/location.service";
import { LocationController } from "./controllers/location.controller";
import { createLocationRouter } from "./routes/location.routes";

export { LocationService } from "./services/location.service";
export { formatLocation } from "./services/location.service";

export const createLocationModule = () => {
  const service = new LocationService(prismaClient);
  const controller = new LocationController(service);
  return createLocationRouter(controller);
};

export default createLocationModule;