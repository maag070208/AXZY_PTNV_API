import type { User } from "../models/dto/user.dto";
import type { UserEntity } from "../models/entity/user.entity";

export const userToDto = (entity: UserEntity): User => ({
  id: entity.id,
  username: entity.username,
  email: entity.email,
  name: entity.name,
  role: entity.role,
  active: entity.active,
  puesto: entity.puesto,
  numeroEmpleado: entity.numeroEmpleado,
  empresa: entity.empresa,
  departmentId: entity.departmentId,
  department: entity.department,
  subareaId: entity.subareaId,
  subarea: entity.subarea,
  createdAt: entity.createdAt.toISOString(),
});