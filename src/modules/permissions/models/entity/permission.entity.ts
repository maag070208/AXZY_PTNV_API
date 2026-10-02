import type { PermissionScope } from "@core/permissions";

/** Permiso del catálogo tal como lo lee la administración (incluye inactivos). */
export interface PermissionCatalog {
  key: string;
  module: string;
  name: string;
  description: string | null;
  scopes: PermissionScope[];
  sensitive: boolean;
  active: boolean;
  sortOrder: number;
}

/** Rol del sistema tal como lo lee la administración. */
export interface RoleAdmin {
  key: string;
  name: string;
  description: string | null;
  module: string | null;
  staff: boolean;
  system: boolean;
  active: boolean;
  sortOrder: number;
  /** Cuántas cuentas tienen este rol (para impedir borrarlo). */
  userCount: number;
}

/** Celda vigente de la matriz rol → permiso → alcance. */
export interface MatrixCell {
  role: string;
  permission: string;
  scope: PermissionScope;
}

/** Payload de la pantalla de administración de roles y permisos. */
export interface RolesAdminData {
  roles: string[];
  catalog: PermissionCatalog[];
  matrix: MatrixCell[];
}
