import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { logger } from "../utils/logger";
import { resolveSeedDataDir } from "../utils/seed-data-dir";
import {
  ALCANCES,
  catalogoFromRows,
  sembrarCatalogo,
  type Alcance,
  type CatalogoFila,
  type DefinicionPermiso,
} from "./catalogo";
import { cargarPermisosDesdeDb } from "./matriz";

/**
 * Fixtures del catálogo de permisos y de la matriz rol → permiso → alcance.
 * Replican `prisma/seed-data/permisos.json` y `prisma/seed-data/rol_permisos.json`
 * (que a su vez son el respaldo real). Se resuelven en runtime para no tocar el
 * disco al importar el módulo.
 */

const dataDir = (): string =>
  resolveSeedDataDir(path.join(__dirname, "..", "..", "..", "prisma"));

const readFixture = (name: string): unknown => {
  const file = path.join(dataDir(), `${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
};

const esAlcance = (v: unknown): v is Alcance =>
  typeof v === "string" && (ALCANCES as readonly string[]).includes(v);

/** Catálogo de permisos normalizado desde `permisos.json`. */
export const loadPermisosFixture = (): DefinicionPermiso[] => {
  const raw = readFixture("permisos");
  const rows = Array.isArray(raw) ? (raw as CatalogoFila[]) : [];
  const catalogo = catalogoFromRows(rows);
  const descartadas = rows.length - catalogo.length;
  if (descartadas > 0) {
    logger.warn(`permisos.json: ${descartadas} fila(s) inválida(s) descartada(s)`);
  }
  return catalogo;
};

export interface RolPermisoFixtureFila {
  rol: string;
  permiso: string;
  alcance: Alcance;
}

/** Matriz normalizada desde `rol_permisos.json`, descartando filas inválidas. */
export const loadRolPermisosFixture = (): RolPermisoFixtureFila[] => {
  const raw = readFixture("rol_permisos");
  if (!Array.isArray(raw)) return [];
  const filas: RolPermisoFixtureFila[] = [];
  for (const fila of raw as Array<Record<string, unknown>>) {
    const rol = fila?.rol;
    const permiso = fila?.permiso;
    const alcance = fila?.alcance;
    if (typeof rol !== "string" || typeof permiso !== "string" || !esAlcance(alcance)) {
      logger.warn(`rol_permisos.json: fila inválida ${JSON.stringify(fila)}`);
      continue;
    }
    filas.push({ rol, permiso, alcance });
  }
  return filas;
};

/**
 * Siembra el catálogo y la matriz desde los fixtures (insert-missing) y deja
 * ambas caches cargadas. Idempotente.
 */
export const sembrarPermisosDesdeFixtures = async (db: PrismaClient): Promise<void> => {
  await sembrarCatalogo(db, loadPermisosFixture());
  await db.rolPermiso.createMany({
    data: loadRolPermisosFixture().map((fila) => ({
      rol: fila.rol as Role,
      permiso: fila.permiso,
      alcance: fila.alcance,
    })),
    skipDuplicates: true,
  });
  await cargarPermisosDesdeDb(db);
};
