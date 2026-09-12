import type { Location } from "../models/dto/location.dto";
import type { LocationEntity } from "../models/entity/location.entity";

export const locationToDto = (entity: LocationEntity): Location => ({
  id: entity.id,
  lugar: entity.lugar,
  subLugar: entity.subLugar,
  numero: entity.numero,
  descripcion: entity.descripcion,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  _count: entity._count,
  devices: entity.devices as unknown as Location["devices"],
});