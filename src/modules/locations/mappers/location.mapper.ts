import type { Location } from "../models/dto/location.dto";
import type { LocationEntity } from "../models/entity/location.entity";

export const locationToDto = (entity: LocationEntity): Location => ({
  id: entity.id,
  lugar: entity.lugar,
  active: entity.active,
  descripcion: entity.descripcion,
  departmentId: entity.departmentId,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  sublugares: entity.sublugares?.map((s) => ({
    id: s.id,
    locationId: s.locationId,
    name: s.name,
    numero: s.numero,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
  })) as unknown as Location["sublugares"],
  _count: entity._count,
  devices: entity.devices as unknown as Location["devices"],
});