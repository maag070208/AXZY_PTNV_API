import { prismaClient } from "@core/config/database";
import { DeviceTypeService } from "./services/device-type.service";
import { DeviceTypeController } from "./controllers/device-type.controller";
import { createDeviceTypeRouter } from "./routes/device-type.routes";

export { DeviceTypeService } from "./services/device-type.service";
export { formatPrefix } from "./services/device-type.service";
export * from "./models/fields/device-type.fields";
export { defaultDeviceFieldConfig, normalizeDeviceFieldConfig } from "./models/fields/device-type.fields";

export const createDeviceTypeModule = () => {
  const service = new DeviceTypeService(prismaClient);
  const controller = new DeviceTypeController(service);
  return createDeviceTypeRouter(controller);
};

export default createDeviceTypeModule;