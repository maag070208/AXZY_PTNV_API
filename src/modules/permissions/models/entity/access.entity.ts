import type { PermissionScope } from "@core/permissions";
import type { PolicyExplanation } from "@core/policies";

/** Persona tal como la ve la consola de roles. */
export interface AccessMember {
  id: string;
  name: string;
  username: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  department: string | null;
  active: boolean;
  /** Rol principal (`users.role`). */
  role: string;
  /** Roles adicionales (`user_roles`), sin el principal. */
  extraRoles: string[];
  /** Excepciones de permiso vigentes. */
  exceptions: number;
}

/** Excepción vigente de un permiso (reemplaza lo que dan los roles). */
export interface AccessException {
  scope: PermissionScope;
  reason: string | null;
  expiresAt: string | null;
}

/** Un permiso del catálogo activo con su alcance efectivo y su origen. */
export interface AccessPermissionView {
  key: string;
  effective: PermissionScope;
  /** Alcance que aporta cada rol de la persona (solo ≠ NONE; los roles inactivos no aportan). */
  byRole: Record<string, PermissionScope>;
  exception: AccessException | null;
}

/** `GET /permissions/members/:userId/access`. */
export interface UserAccessView {
  user: AccessMember;
  roles: Array<{ key: string; primary: boolean; active: boolean }>;
  permissions: AccessPermissionView[];
}

/** Body de `POST /permissions/simulate`. */
export interface SimulationInput {
  userId: string;
  permission: string;
  /** Campos del registro para las políticas ABAC (solo los que declara la acción). */
  resource?: Record<string, unknown> | null;
}

/** Resultado del probador: las tres capas del control de acceso. */
export interface AccessSimulation {
  allowed: boolean;
  identity: { ok: boolean; active: boolean };
  rbac: {
    ok: boolean;
    permissionActive: boolean;
    scope: PermissionScope;
    byRole: Record<string, PermissionScope>;
    exception: AccessException | null;
  };
  abac: {
    /** Se evaluó (identidad y RBAC pasaron y la acción tiene reglas). */
    evaluated: boolean;
    ok: boolean;
    hasRules: boolean;
    /** La acción declara campos de registro (admite políticas con condiciones). */
    supportsContext: boolean;
    explanation: PolicyExplanation | null;
  };
}

/** Renglón de la bitácora del control de acceso. */
export interface AccessActivityRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string | null; name: string | null; username: string | null };
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}
