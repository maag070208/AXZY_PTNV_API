import type { Role } from "@prisma/client";
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

/** Celda vigente de la matriz rol → permiso → alcance. */
export interface MatrixCell {
  role: Role;
  permission: string;
  scope: PermissionScope;
}

/** Payload de la pantalla de administración de roles y permisos. */
export interface RolesAdminData {
  roles: Role[];
  catalog: PermissionCatalog[];
  matrix: MatrixCell[];
}
