import { prismaClient } from "@core/config/database";
import { CartaConsecutivoService } from "./services/carta-consecutivo.service";
import { CartaService } from "./services/carta.service";
import { CartaController } from "./controllers/carta.controller";
import { createCartaRouter } from "./routes/carta.routes";

export const createCartaModule = () => {
  const consecutivoService = new CartaConsecutivoService(prismaClient);
  const cartaService = new CartaService(prismaClient);
  const controller = new CartaController(cartaService, consecutivoService);
  return createCartaRouter(controller);
};

export default createCartaModule;