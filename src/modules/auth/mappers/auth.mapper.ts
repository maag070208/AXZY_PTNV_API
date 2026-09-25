import type { User } from "@prisma/client";
import { permisosDe } from "@core/permisos";
import type { AuthUserEntity } from "../models/entity/auth.entity";
import type { AuthMe, AuthUser } from "../models/dto/auth.dto";

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

/** Usuario de la sesión + datos de su credencial (`GET /auth/me`). */
export const userToAuthMeDto = (
  user: User & { department: { id: string; name: string } | null }
): AuthMe => ({
  ...entityToAuthUserDto(userToEntity(user)),
  numeroEmpleado: user.numeroEmpleado,
  puesto: user.puesto,
  department: user.department,
  fotoUrl: user.fotoKey ? `/personal/${user.id}/foto/raw` : null,
  permisos: permisosDe(user),
});
