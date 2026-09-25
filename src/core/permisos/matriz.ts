import type { PrismaClient, Role } from "@prisma/client";
import { esPermiso, type Alcance, type Permiso } from "./catalogo";
import { ROLES_BASE } from "./roles";

/**
 * Matriz rol → permiso → alcance en memoria (Fase 1).
 *
 * La fuente en runtime es la tabla `rol_permisos`: al arrancar se siembra con
 * los defaults del código (insert-missing, sin pisar ediciones) y se carga en
 * esta cache. `ROLES_BASE` queda como fallback si la BD falla o todavía no se
 * cargó, de modo que el resolvedor nunca se queda sin matriz.
 *
 * Importa `PrismaClient` solo como tipo para que el runner unitario no cargue
 * el cliente.
 */

export type MatrizRoles = Record<Role, Partial<Record<Permiso, Alcance>>>;

/** Fila tal como la devuelve `rol_permisos` (clave sin tipar: puede no existir). */
export interface MatrizFila {
  rol: Role;
  permiso: string;
  alcance: string;
}

/** Fila lista para sembrar: ya validada contra el catálogo. */
export interface MatrizFilaDefecto {
  rol: Role;
  permiso: Permiso;
  alcance: Alcance;
}

const ROLES = Object.keys(ROLES_BASE) as Role[];

const clonarMatriz = (matriz: MatrizRoles): MatrizRoles =>
  Object.fromEntries(
    Object.entries(matriz).map(([rol, permisos]) => [rol, { ...permisos }])
  ) as MatrizRoles;

/** Matriz vacía con todos los roles presentes (todo NINGUNO). */
const matrizVacia = (): MatrizRoles => {
  const matriz = {} as MatrizRoles;
  for (const rol of ROLES) matriz[rol] = {};
  return matriz;
};

let cache: MatrizRoles = clonarMatriz(ROLES_BASE);

/** Matriz vigente (BD si ya se cargó; defaults del código si no). */
export const getMatriz = (): MatrizRoles => cache;

/** Reemplaza la matriz vigente (la carga desde BD usa esto). */
export const setMatriz = (matriz: MatrizRoles): void => {
  cache = matriz;
};

/** Vuelve a los defaults del código (fallback). */
export const resetMatriz = (): void => {
  cache = clonarMatriz(ROLES_BASE);
};

/**
 * Descarta la matriz cargada y cae a los defaults hasta la próxima carga.
 * La escritura de `rol_permisos` (Fase 3) debe llamarla y recargar.
 */
export const invalidarMatriz = (): void => {
  resetMatriz();
};

/**
 * Construye la matriz desde filas de `rol_permisos`. **Puro.** Ignora las
 * claves fuera del catálogo y las filas con alcance NINGUNO (la ausencia de
 * fila ya significa NINGUNO).
 */
export const matrizFromRows = (rows: ReadonlyArray<MatrizFila>): MatrizRoles => {
  const matriz = matrizVacia();
  for (const fila of rows) {
    if (!esPermiso(fila.permiso)) continue;
    if (fila.alcance === "NINGUNO") continue;
    matriz[fila.rol][fila.permiso] = fila.alcance as Alcance;
  }
  return matriz;
};

/** Lee `rol_permisos` y deja la matriz en cache. */
export const cargarMatrizDesdeDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.rolPermiso.findMany({
    select: { rol: true, permiso: true, alcance: true },
  });
  setMatriz(matrizFromRows(rows));
};

/**
 * Deriva las filas de la seed desde `ROLES_BASE`. **Puro.** Omite las claves
 * sin alcance y las NINGUNO: los defaults solo listan lo que se concede.
 */
export const filasMatrizPorDefecto = (): MatrizFilaDefecto[] => {
  const filas: MatrizFilaDefecto[] = [];
  for (const rol of ROLES) {
    const permisos = ROLES_BASE[rol] ?? {};
    for (const [permiso, alcance] of Object.entries(permisos) as [Permiso, Alcance][]) {
      if (alcance && alcance !== "NINGUNO") filas.push({ rol, permiso, alcance });
    }
  }
  return filas;
};

/**
 * Siembra los defaults de forma idempotente: inserta solo lo que falta
 * (`skipDuplicates`), nunca pisa filas existentes. Devuelve cuántas insertó.
 */
export const sembrarMatrizPorDefecto = async (db: PrismaClient): Promise<number> => {
  const { count } = await db.rolPermiso.createMany({
    data: filasMatrizPorDefecto(),
    skipDuplicates: true,
  });
  return count;
};
