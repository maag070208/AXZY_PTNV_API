import type { User } from "../models/dto/user.dto";
import type { UserEntity } from "../models/entity/user.entity";

export const userToDto = (entity: UserEntity): User => ({
  id: entity.id,
  username: entity.username,
  email: entity.email,
  name: entity.name,
  role: entity.role,
  active: entity.active,
  jobTitle: entity.jobTitle,
  employeeNumber: entity.employeeNumber,
  company: entity.company,
  departmentId: entity.departmentId,
  department: entity.department,
  subareaId: entity.subareaId,
  subarea: entity.subarea,
  createdAt: entity.createdAt.toISOString(),
});