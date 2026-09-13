import { prismaClient } from "@core/config/database";
import { LocationService } from "./services/location.service";
import { SublugarService } from "./services/sublugar.service";
import { LocationController } from "./controllers/location.controller";
import { createLocationRouter } from "./routes/location.routes";

export { LocationService } from "./services/location.service";
export { SublugarService } from "./services/sublugar.service";
export { formatLocation } from "./services/location.service";

export const createLocationModule = () => {
  const locations = new LocationService(prismaClient);
  const sublugares = new SublugarService(prismaClient);
  const controller = new LocationController(locations, sublugares);
  return createLocationRouter(controller);
};

export default createLocationModule;