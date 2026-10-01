import type { PrismaClient } from "@prisma/client";

/**
 * Catálogo de roles del sistema. Hasta la Fase 1 los roles eran el enum Prisma
 * `Role` (7 valores fijos); ahora viven en la tabla `roles` y se administran
 * desde `/roles` (permiso `roles.manage`). Igual que el catálogo de permisos,
 * el código solo mantiene una cache en memoria que se llena desde la BD: sin
 * roles cargados no hay rol válido y todo queda cerrado (fail-closed).
 *
 * `staff` marca los roles con expediente de personal (RH: checador, nómina,
 * horas extra); reemplaza la lista fija MANAGER/AREA_HEAD/EMPLOYEE. `system`
 * protege los roles base de borrado.
 */
export interface RoleDefinition {
  key: string;
  name: string;
  description: string | null;
  module: string | null;
  staff: boolean;
  system: boolean;
  active: boolean;
  sortOrder: number;
}

/** Fila cruda (Prisma o fixture) previa a la normalización. */
export interface RoleRow {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  module?: unknown;
  staff?: unknown;
  system?: unknown;
  active?: unknown;
  sortOrder?: unknown;
}

/**
 * Roles que se consideran "personal de expediente" mientras la cache no está
 * cargada (arranque temprano o pruebas unitarias). En runtime manda `staff`.
 */
export const DEFAULT_STAFF_ROLE_KEYS: readonly string[] = [
  "MANAGER",
  "AREA_HEAD",
  "EMPLOYEE",
];

/** Rol por defecto al crear una cuenta (debe existir en el catálogo). */
export const DEFAULT_ROLE_KEY = "EMPLOYEE";

/** Normaliza filas a `RoleDefinition`. **Puro.** Descarta filas inválidas. */
export const rolesFromRows = (rows: ReadonlyArray<RoleRow>): RoleDefinition[] => {
  const out: RoleDefinition[] = [];
  for (const row of rows) {
    if (!row) continue;
    const { key, name } = row;
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({
      key,
      name,
      description: typeof row.description === "string" ? row.description : null,
      module: typeof row.module === "string" ? row.module : null,
      staff: row.staff === true,
      system: row.system === true,
      active: row.active !== false,
      sortOrder:
        typeof row.sortOrder === "number" && Number.isInteger(row.sortOrder)
          ? row.sortOrder
          : 0,
    });
  }
  return out;
};

let roles: RoleDefinition[] = [];
let activeKeys = new Set<string>();
const definitions = new Map<string, RoleDefinition>();

/** Roles vigentes (BD si ya se cargó; vacío si no). */
export const getRoles = (): RoleDefinition[] => roles;

/** Reemplaza la cache de roles y recalcula claves activas e índice. */
export const setRoles = (list: RoleDefinition[]): void => {
  roles = list;
  activeKeys = new Set(list.filter((r) => r.active).map((r) => r.key));
  definitions.clear();
  for (const role of list) definitions.set(role.key, role);
};

/** Deja la cache de roles vacía (fail-closed). */
export const resetRoles = (): void => {
  setRoles([]);
};

/** ¿Existe un rol activo con esa clave? */
export const isRole = (key: string): boolean => activeKeys.has(key);

/** Claves de los roles activos. */
export const roleKeys = (): string[] => [...activeKeys];

/** Definición de un rol (activo o no), o `undefined` si no existe. */
export const definitionOfRole = (key: string): RoleDefinition | undefined =>
  definitions.get(key);

/** Claves de los roles activos con expediente de personal. */
export const staffRoleKeys = (): string[] => {
  if (roles.length === 0) return [...DEFAULT_STAFF_ROLE_KEYS];
  return roles.filter((r) => r.active && r.staff).map((r) => r.key);
};

/** Lee `roles` y deja la cache cargada. */
export const loadRolesFromDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.role.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  setRoles(rolesFromRows(rows));
};
