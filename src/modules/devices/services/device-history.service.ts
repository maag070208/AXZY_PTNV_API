import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

export class DeviceHistoryService {
  constructor(private readonly db = prismaClient) {}

  async getHistory(deviceId: string) {
    const device = await this.db.device.findUnique({ where: { id: deviceId }, select: { id: true } });
    if (!device) throw new HttpError(404, "Dispositivo no encontrado");

    return this.db.deviceHistory.findMany({
      where: { deviceId },
      include: { autor: { select: { id: true, name: true, username: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async add(deviceId: string, type: string, detail?: string, autorId?: string) {
    return this.db.deviceHistory.create({
      data: { deviceId, type, detail: detail ?? null, autorId: autorId ?? null },
    });
  }
}