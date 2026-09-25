import type { PrismaClient } from "@prisma/client";
import {
  ALCANCES,
  cargarCatalogoDesdeDb,
  clavesDeCatalogo,
  type Alcance,
  type DefinicionPermiso,
} from "./catalogo";

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

export type MatrizRoles = Record<string, Partial<Record<string, Alcance>>>;

/** Fila tal como la devuelve `rol_permisos` (clave sin tipar: puede no existir). */
export interface MatrizFila {
  rol: string;
  permiso: string;
  alcance: string;
}

const esAlcance = (v: string): v is Alcance =>
  (ALCANCES as readonly string[]).includes(v);

let cache: MatrizRoles = {};

/** Matriz vigente (BD si ya se cargó; vacía si no). */
export const getMatriz = (): MatrizRoles => cache;

/** Reemplaza la matriz vigente (la carga desde BD usa esto). */
export const setMatriz = (matriz: MatrizRoles): void => {
  cache = matriz;
};

/** Deja la matriz vacía (fail-closed). */
export const resetMatriz = (): void => {
  cache = {};
};

/** Descarta la matriz cargada hasta la próxima carga. */
export const invalidarMatriz = (): void => {
  setMatriz({});
};

/**
 * Construye la matriz desde filas de `rol_permisos`. **Puro.** Ignora las
 * claves que no estén en el catálogo **activo** (el que se pase o, por defecto,
 * la cache vigente) y las filas con alcance NINGUNO (la ausencia de fila ya
 * significa NINGUNO).
 */
export const matrizFromRows = (
  rows: ReadonlyArray<MatrizFila>,
  catalogo?: ReadonlyArray<DefinicionPermiso>
): MatrizRoles => {
  const activos = catalogo
    ? new Set(catalogo.filter((p) => p.activo).map((p) => p.clave))
    : new Set(clavesDeCatalogo());
  const matriz: MatrizRoles = {};
  for (const fila of rows) {
    if (!activos.has(fila.permiso)) continue;
    if (fila.alcance === "NINGUNO" || !esAlcance(fila.alcance)) continue;
    (matriz[fila.rol] ??= {})[fila.permiso] = fila.alcance;
  }
  return matriz;
};

/** Lee `rol_permisos` (solo permisos activos) y deja la matriz en cache. */
export const cargarMatrizDesdeDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.rolPermiso.findMany({
    where: { permisoRef: { activo: true } },
    select: { rol: true, permiso: true, alcance: true },
  });
  setMatriz(matrizFromRows(rows));
};

/**
 * Carga catálogo y matriz desde la BD (en ese orden). Se usa tras cada
 * escritura y en el arranque.
 */
export const cargarPermisosDesdeDb = async (db: PrismaClient): Promise<void> => {
  await cargarCatalogoDesdeDb(db);
  await cargarMatrizDesdeDb(db);
};
