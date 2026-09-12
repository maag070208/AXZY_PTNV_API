import type { User } from "@prisma/client";
import type { AuthUserEntity } from "../models/entity/auth.entity";
import type { AuthUser } from "../models/dto/auth.dto";

export const userToEntity = (user: User): AuthUserEntity => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  departmentId: user.departmentId,
  active: user.active,
  password: user.password,
});

export const entityToAuthUserDto = (entity: AuthUserEntity): AuthUser => ({
  id: entity.id,
  username: entity.username,
  email: entity.email,
  name: entity.name,
  role: entity.role,
  departmentId: entity.departmentId,
});