import { prismaClient } from "@core/config/database";
import { MaterialOutputService, type UnitRetirementPort } from "./services/material-output.service";
import { MaterialOutputController } from "./controllers/material-output.controller";
import { createMaterialOutputsRouter } from "./routes/material-output.routes";

export const createMaterialOutputsModule = (inventory: UnitRetirementPort) => {
  const service = new MaterialOutputService(inventory, prismaClient);
  const controller = new MaterialOutputController(service);
  return createMaterialOutputsRouter(controller);
};

export default createMaterialOutputsModule;