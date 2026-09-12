import { prismaClient } from "@core/config/database";
import type { DeviceTypePort } from "./services/ports";
import { DeviceHistoryService } from "./services/device-history.service";
import { DeviceLoteService } from "./services/device-lote.service";
import { DeviceService } from "./services/device.service";
import { DeviceController } from "./controllers/device.controller";
import { createDevicesRouter } from "./routes/device.routes";

export const createDevicesModule = (deviceTypePort: DeviceTypePort) => {
  const deviceService = new DeviceService(deviceTypePort, prismaClient);
  const deviceLoteService = new DeviceLoteService(deviceTypePort, prismaClient);
  const deviceHistoryService = new DeviceHistoryService(prismaClient);
  const controller = new DeviceController(
    deviceService,
    deviceLoteService,
    deviceHistoryService
  );
  return createDevicesRouter(controller);
};

export default createDevicesModule;