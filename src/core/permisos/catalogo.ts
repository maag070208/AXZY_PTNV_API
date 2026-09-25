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
export type Alcance = "NINGUNO" | "PROPIO" | "AREA" | "TODO";

export const ALCANCES: readonly Alcance[] = ["NINGUNO", "PROPIO", "AREA", "TODO"];

export interface DefinicionPermiso {
  clave: string;
  modulo: string;
  nombre: string;
  descripcion?: string | null;
  alcances: Alcance[];
  sensible: boolean;
  activo: boolean;
  orden: number;
}

/** Fila cruda (Prisma o fixture) previa a la normalización. */
export interface CatalogoFila {
  clave?: unknown;
  modulo?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  alcances?: unknown;
  sensible?: unknown;
  activo?: unknown;
  orden?: unknown;
}

const esAlcance = (v: unknown): v is Alcance =>
  typeof v === "string" && (ALCANCES as readonly string[]).includes(v);

/**
 * Normaliza filas a `DefinicionPermiso`. **Puro.** Descarta las filas que no
 * cumplen el formato (sin clave/módulo/nombre o con `alcances` vacío o fuera
 * del enum). Los campos opcionales toman su default.
 */
export const catalogoFromRows = (
  rows: ReadonlyArray<CatalogoFila>
): DefinicionPermiso[] => {
  const out: DefinicionPermiso[] = [];
  for (const row of rows) {
    if (!row) continue;
    const { clave, modulo, nombre } = row;
    if (typeof clave !== "string" || !clave.trim()) continue;
    if (typeof modulo !== "string" || !modulo.trim()) continue;
    if (typeof nombre !== "string" || !nombre.trim()) continue;
    if (!Array.isArray(row.alcances) || row.alcances.length === 0) continue;
    if (!row.alcances.every(esAlcance)) continue;
    out.push({
      clave,
      modulo,
      nombre,
      descripcion: typeof row.descripcion === "string" ? row.descripcion : null,
      alcances: [...row.alcances],
      sensible: row.sensible === true,
      activo: row.activo !== false,
      orden: typeof row.orden === "number" && Number.isInteger(row.orden) ? row.orden : 0,
    });
  }
  return out;
};

let catalogo: DefinicionPermiso[] = [];
let clavesActivas = new Set<string>();
const definiciones = new Map<string, DefinicionPermiso>();

/** Catálogo vigente (BD si ya se cargó; vacío si no). */
export const getCatalogo = (): DefinicionPermiso[] => catalogo;

/** Reemplaza el catálogo vigente y recalcula claves activas e índice. */
export const setCatalogo = (list: DefinicionPermiso[]): void => {
  catalogo = list;
  clavesActivas = new Set(list.filter((p) => p.activo).map((p) => p.clave));
  definiciones.clear();
  for (const permiso of list) definiciones.set(permiso.clave, permiso);
};

/** Deja el catálogo vacío (fail-closed). */
export const resetCatalogo = (): void => {
  setCatalogo([]);
};

/** ¿Existe un permiso activo con esa clave? */
export const esPermiso = (clave: string): boolean => clavesActivas.has(clave);

/** Claves de los permisos activos. */
export const clavesDeCatalogo = (): string[] => [...clavesActivas];

/** Definición de un permiso (activo o no), o `undefined` si no está en el catálogo. */
export const definicionDe = (clave: string): DefinicionPermiso | undefined =>
  definiciones.get(clave);

/** Lee `permisos` y deja el catálogo en cache. */
export const cargarCatalogoDesdeDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.permiso.findMany({
    orderBy: [{ modulo: "asc" }, { orden: "asc" }],
  });
  setCatalogo(catalogoFromRows(rows));
};

/**
 * Siembra el catálogo de forma idempotente: inserta solo lo que falta
 * (`skipDuplicates`), nunca pisa filas existentes. Devuelve cuántas insertó.
 */
export const sembrarCatalogo = async (
  db: PrismaClient,
  rows: ReadonlyArray<DefinicionPermiso>
): Promise<number> => {
  const { count } = await db.permiso.createMany({
    data: [...rows],
    skipDuplicates: true,
  });
  return count;
};
