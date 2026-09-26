import type { PrismaClient } from "@prisma/client";
import {
  SCOPES,
  loadCatalogFromDb,
  catalogKeys,
  type PermissionScope,
  type PermissionDefinition,
} from "./catalog";

/**
 * Matriz rol → permiso → alcance en memoria (Fase 1).
 *
 * La fuente en runtime es la tabla `rol_permisos`: se siembra insert-missing
 * (sin pisar ediciones) y se carga en esta cache. La cache arranca **vacía**:
 * sin datos no hay permisos y el resolvedor devuelve NINGUNO (fail-closed).
 *
 * Importa `PrismaClient` solo como tipo para que el runner unitario no cargue
 * el cliente.
 */

export type RoleMatrix = Record<string, Partial<Record<string, PermissionScope>>>;

/** Fila tal como la devuelve `rol_permisos` (clave sin tipar: puede no existir). */
export interface MatrixRow {
  role: string;
  permission: string;
  scope: string;
}

const isScope = (v: string): v is PermissionScope =>
  (SCOPES as readonly string[]).includes(v);

let cache: RoleMatrix = {};

/** Matriz vigente (BD si ya se cargó; vacía si no). */
export const getMatrix = (): RoleMatrix => cache;

/** Reemplaza la matriz vigente (la carga desde BD usa esto). */
export const setMatrix = (matrix: RoleMatrix): void => {
  cache = matrix;
};

/** Deja la matriz vacía (fail-closed). */
export const resetMatrix = (): void => {
  cache = {};
};

/** Descarta la matriz cargada hasta la próxima carga. */
export const invalidateMatrix = (): void => {
  setMatrix({});
};

/**
 * Construye la matriz desde filas de `rol_permisos`. **Puro.** Ignora las
 * claves que no estén en el catálogo **activo** (el que se pase o, por defecto,
 * la cache vigente) y las filas con alcance NINGUNO (la ausencia de fila ya
 * significa NINGUNO).
 */
export const matrixFromRows = (
  rows: ReadonlyArray<MatrixRow>,
  catalog?: ReadonlyArray<PermissionDefinition>
): RoleMatrix => {
  const activeKeys = catalog
    ? new Set(catalog.filter((p) => p.active).map((p) => p.key))
    : new Set(catalogKeys());
  const matrix: RoleMatrix = {};
  for (const row of rows) {
    if (!activeKeys.has(row.permission)) continue;
    if (row.scope === "NONE" || !isScope(row.scope)) continue;
    (matrix[row.role] ??= {})[row.permission] = row.scope;
  }
  return matrix;
};

/** Lee `rol_permisos` (solo permisos activos) y deja la matriz en cache. */
export const loadMatrixFromDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.rolePermission.findMany({
    where: { permissionRef: { active: true } },
    select: { role: true, permission: true, scope: true },
  });
  setMatrix(matrixFromRows(rows));
};

/**
 * Carga catálogo y matriz desde la BD (en ese orden). Se usa tras cada
 * escritura y en el arranque.
 */
export const loadPermissionsFromDb = async (db: PrismaClient): Promise<void> => {
  await loadCatalogFromDb(db);
  await loadMatrixFromDb(db);
};
