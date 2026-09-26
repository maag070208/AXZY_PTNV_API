import type { PrismaClient } from "@prisma/client";

/**
 * Catálogo de permisos del sistema. Desde el Incremento 2 la fuente única de
 * verdad es la tabla `permisos`: el código solo mantiene una cache en memoria
 * que se llena desde la BD (o desde los fixtures en la seed). Sin catálogo
 * cargado no existe ningún permiso válido y todo queda cerrado (fail-closed).
 *
 * `Alcance` se declara como literal propio (sin importar Prisma) para que el
 * runner unitario no cargue el cliente.
 */
export type PermissionScope = "NONE" | "OWN" | "AREA" | "ALL";

export const SCOPES: readonly PermissionScope[] = ["NONE", "OWN", "AREA", "ALL"];

export interface PermissionDefinition {
  key: string;
  module: string;
  name: string;
  description?: string | null;
  scopes: PermissionScope[];
  sensitive: boolean;
  active: boolean;
  sortOrder: number;
}

/** Fila cruda (Prisma o fixture) previa a la normalización. */
export interface CatalogRow {
  key?: unknown;
  module?: unknown;
  name?: unknown;
  description?: unknown;
  scopes?: unknown;
  sensitive?: unknown;
  active?: unknown;
  sortOrder?: unknown;
}

const isScope = (v: unknown): v is PermissionScope =>
  typeof v === "string" && (SCOPES as readonly string[]).includes(v);

/**
 * Normaliza filas a `DefinicionPermiso`. **Puro.** Descarta las filas que no
 * cumplen el formato (sin clave/módulo/nombre o con `alcances` vacío o fuera
 * del enum). Los campos opcionales toman su default.
 */
export const catalogFromRows = (
  rows: ReadonlyArray<CatalogRow>
): PermissionDefinition[] => {
  const out: PermissionDefinition[] = [];
  for (const row of rows) {
    if (!row) continue;
    const { key, module, name } = row;
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof module !== "string" || !module.trim()) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    if (!Array.isArray(row.scopes) || row.scopes.length === 0) continue;
    if (!row.scopes.every(isScope)) continue;
    out.push({
      key,
      module,
      name,
      description: typeof row.description === "string" ? row.description : null,
      scopes: [...row.scopes],
      sensitive: row.sensitive === true,
      active: row.active !== false,
      sortOrder: typeof row.sortOrder === "number" && Number.isInteger(row.sortOrder) ? row.sortOrder : 0,
    });
  }
  return out;
};

let catalog: PermissionDefinition[] = [];
let activeKeys = new Set<string>();
const definitions = new Map<string, PermissionDefinition>();

/** Catálogo vigente (BD si ya se cargó; vacío si no). */
export const getCatalog = (): PermissionDefinition[] => catalog;

/** Reemplaza el catálogo vigente y recalcula claves activas e índice. */
export const setCatalog = (list: PermissionDefinition[]): void => {
  catalog = list;
  activeKeys = new Set(list.filter((p) => p.active).map((p) => p.key));
  definitions.clear();
  for (const permission of list) definitions.set(permission.key, permission);
};

/** Deja el catálogo vacío (fail-closed). */
export const resetCatalog = (): void => {
  setCatalog([]);
};

/** ¿Existe un permiso activo con esa clave? */
export const isPermission = (key: string): boolean => activeKeys.has(key);

/** Claves de los permisos activos. */
export const catalogKeys = (): string[] => [...activeKeys];

/** Definición de un permiso (activo o no), o `undefined` si no está en el catálogo. */
export const definitionOf = (key: string): PermissionDefinition | undefined =>
  definitions.get(key);

/** Lee `permisos` y deja el catálogo en cache. */
export const loadCatalogFromDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.permission.findMany({
    orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
  });
  setCatalog(catalogFromRows(rows));
};

/**
 * Siembra el catálogo de forma idempotente: inserta solo lo que falta
 * (`skipDuplicates`), nunca pisa filas existentes. Devuelve cuántas insertó.
 */
export const seedCatalog = async (
  db: PrismaClient,
  rows: ReadonlyArray<PermissionDefinition>
): Promise<number> => {
  const { count } = await db.permission.createMany({
    data: [...rows],
    skipDuplicates: true,
  });
  return count;
};
