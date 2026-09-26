import { prismaClient } from "@core/config/database";
import { SalidaService } from "./services/salida.service";
import { SalidaController } from "./controllers/salida.controller";
import { createSalidasRouter } from "./routes/salida.routes";

export const createSalidasModule = () => {
  const service = new SalidaService(prismaClient);
  const controller = new SalidaController(service);
  return createSalidasRouter(controller);
};

export default createSalidasModule;