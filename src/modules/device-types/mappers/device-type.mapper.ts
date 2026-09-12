import type { DeviceType } from "../models/dto/device-type.dto";
import type { DeviceTypeEntity } from "../models/entity/device-type.entity";

export const entityToDto = (entity: DeviceTypeEntity): DeviceType => ({
  id: entity.id,
  code: entity.code,
  name: entity.name,
  prefix: entity.prefix,
  contador: entity.contador,
  cartaContador: entity.cartaContador,
  active: entity.active,
  fieldConfig: (entity.fieldConfig ?? {}) as DeviceType["fieldConfig"],
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  _count: entity._count,
});