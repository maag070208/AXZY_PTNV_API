import type { Language } from "@core/i18n";
import type { User } from "@prisma/client";
import { permissionsOf, type PermissionScope } from "@core/permissions";
import type { AuthUserEntity } from "../models/entity/auth.entity";
import type { AuthMe, AuthUser } from "../models/dto/auth.dto";

export const userToEntity = (
  user: User & { extraRoles?: Array<{ role: string }> }
): AuthUserEntity => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  roles: [user.role, ...(user.extraRoles ?? []).map((r) => r.role)],
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
  roles: entity.roles,
  departmentId: entity.departmentId,
});

/** Usuario de la sesión + datos de su credencial (`GET /auth/me`). */
export const userToAuthMeDto = (
  user: User & {
    department: { id: string; name: string } | null;
    extraRoles?: Array<{ role: string }>;
    permissionGrants?: Array<{ permission: string; scope: PermissionScope; expiresAt: Date | null }>;
  },
  language: Language
): AuthMe => ({
  ...entityToAuthUserDto(userToEntity(user)),
  employeeNumber: user.employeeNumber,
  jobTitle: user.jobTitle,
  department: user.department,
  photoUrl: user.photoKey ? `/hr/${user.id}/photo/raw` : null,
  permissions: permissionsOf({
    id: user.id,
    role: user.role,
    roles: [user.role, ...(user.extraRoles ?? []).map((r) => r.role)],
    departmentId: user.departmentId,
    exceptions: (user.permissionGrants ?? []).map((grant) => ({
      permission: grant.permission,
      scope: grant.scope,
      expiresAt: grant.expiresAt,
    })),
  }),
  language,
});
