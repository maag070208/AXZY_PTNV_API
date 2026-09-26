import type { Role } from "@prisma/client";
import { catalogKeys, isPermission, type PermissionScope } from "./catalog";
import { getMatrix } from "./matrix";

/**
 * Excepción de permiso de un usuario (Fase 2). Reemplaza lo que dice su rol.
 * Una excepción vencida se ignora.
 */
export interface PermissionException {
  permission: string;
  scope: PermissionScope;
  expiresEn?: Date | null;
}

export interface UserPermissions {
  id: string;
  role: Role;
  departmentId?: string | null;
  /** Fase 2: excepciones por empleado. En Fase 1 es opcional/undefined. */
  exceptions?: ReadonlyArray<PermissionException>;
}

const current = (exception: PermissionException, now: number): boolean =>
  !exception.expiresEn || exception.expiresEn.getTime() > now;

/**
 * Permiso efectivo = excepción vigente > rol base > NINGUNO (ver
 * ROLES_Y_PERMISOS.md §2).
 *
 * Un permiso que no está en el catálogo **activo** no significa nada: devuelve
 * NINGUNO aunque la matriz traiga una fila vieja (fail-closed).
 */
export const scopeOf = (user: UserPermissions, permission: string): PermissionScope => {
  const now = Date.now();
  const exception = user.exceptions?.find(
    (e) => e.permission === permission && current(e, now)
  );
  if (exception) return exception.scope;
  if (!isPermission(permission)) return "NONE";
  return getMatrix()[user.role]?.[permission] ?? "NONE";
};

/** ¿El usuario tiene el permiso con cualquier alcance distinto de NINGUNO? */
export const canAnyScope = (user: UserPermissions, permission: string): boolean =>
  scopeOf(user, permission) !== "NONE";

/** Todos los permisos efectivos del usuario, omitiendo los NINGUNO. */
export const permissionsOf = (user: UserPermissions): Record<string, PermissionScope> => {
  const result: Record<string, PermissionScope> = {};
  for (const permission of catalogKeys()) {
    const scope = scopeOf(user, permission);
    if (scope !== "NONE") result[permission] = scope;
  }
  return result;
};
