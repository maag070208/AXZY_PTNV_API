import { catalogKeys, isPermission, type PermissionScope } from "./catalog";
import { getMatrix } from "./matrix";

/**
 * Excepción de permiso de un usuario (Fase 2). Reemplaza lo que dice su rol.
 * Una excepción vencida se ignora.
 */
export interface PermissionException {
  permission: string;
  scope: PermissionScope;
  expiresAt?: Date | null;
}

export interface UserPermissions {
  id: string;
  /** Rol principal. */
  role: string;
  /** Roles adicionales (multi-rol). Los permisos efectivos son la unión. */
  roles?: readonly string[];
  departmentId?: string | null;
  /** Fase 2: excepciones por empleado. En Fase 1 es opcional/undefined. */
  exceptions?: ReadonlyArray<PermissionException>;
}

/** Orden de alcances de menor a mayor, para combinar varios roles. */
const SCOPE_RANK: Record<PermissionScope, number> = {
  NONE: 0,
  OWN: 1,
  AREA: 2,
  ALL: 3,
};

/** El alcance mayor de dos (los roles se suman, nunca se restan). */
export const maxScope = (a: PermissionScope, b: PermissionScope): PermissionScope =>
  SCOPE_RANK[b] > SCOPE_RANK[a] ? b : a;

/** Roles del usuario: el principal + los adicionales (sin duplicados). */
export const rolesOf = (user: UserPermissions): string[] => {
  const extra = user.roles ?? [];
  return [...new Set([user.role, ...extra])];
};

const current = (exception: PermissionException, now: number): boolean =>
  !exception.expiresAt || exception.expiresAt.getTime() > now;

/**
 * Permiso efectivo = excepción vigente > unión de roles > NINGUNO (ver
 * ROLES_Y_PERMISOS.md §2). Con varios roles, el alcance es el mayor de todos.
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
  const matrix = getMatrix();
  let scope: PermissionScope = "NONE";
  for (const role of rolesOf(user)) {
    scope = maxScope(scope, matrix[role]?.[permission] ?? "NONE");
  }
  return scope;
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
