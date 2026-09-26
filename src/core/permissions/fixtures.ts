import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { logger } from "../utils/logger";
import { resolveSeedDataDir } from "../utils/seed-data-dir";
import {
  SCOPES,
  catalogFromRows,
  seedCatalog,
  type PermissionScope,
  type CatalogRow,
  type PermissionDefinition,
} from "./catalog";
import { loadPermissionsFromDb } from "./matrix";

/**
 * Fixtures del catálogo de permisos y de la matriz rol → permiso → alcance.
 * Replican `prisma/seed-data/permissions.json` y `prisma/seed-data/role_permissions.json`
 * (que a su vez son el respaldo real). Se resuelven en runtime para no tocar el
 * disco al importar el módulo.
 */

const dataDir = (): string =>
  resolveSeedDataDir(path.join(__dirname, "..", "..", "..", "prisma"));

const readFixture = (name: string): unknown => {
  const file = path.join(dataDir(), `${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
};

const isScope = (v: unknown): v is PermissionScope =>
  typeof v === "string" && (SCOPES as readonly string[]).includes(v);

/** Catálogo de permisos normalizado desde `permissions.json`. */
export const loadPermissionsFixture = (): PermissionDefinition[] => {
  const raw = readFixture("permissions");
  const rows = Array.isArray(raw) ? (raw as CatalogRow[]) : [];
  const catalog = catalogFromRows(rows);
  const discarded = rows.length - catalog.length;
  if (discarded > 0) {
    logger.warn(`permissions.json: ${discarded} invalid row(s) discarded`);
  }
  return catalog;
};

export interface RolePermissionFixtureRow {
  role: string;
  permission: string;
  scope: PermissionScope;
}

/** Matriz normalizada desde `role_permissions.json`, descartando filas inválidas. */
export const loadRolePermissionsFixture = (): RolePermissionFixtureRow[] => {
  const raw = readFixture("role_permissions");
  if (!Array.isArray(raw)) return [];
  const rows: RolePermissionFixtureRow[] = [];
  for (const row of raw as Array<Record<string, unknown>>) {
    const role = row?.role;
    const permission = row?.permission;
    const scope = row?.scope;
    if (typeof role !== "string" || typeof permission !== "string" || !isScope(scope)) {
      logger.warn(`role_permissions.json: invalid row ${JSON.stringify(row)}`);
      continue;
    }
    rows.push({ role, permission, scope });
  }
  return rows;
};

/**
 * Siembra el catálogo y la matriz desde los fixtures (insert-missing) y deja
 * ambas caches cargadas. Idempotente.
 */
export const seedPermissionsFromFixtures = async (db: PrismaClient): Promise<void> => {
  await seedCatalog(db, loadPermissionsFixture());
  await db.rolePermission.createMany({
    data: loadRolePermissionsFixture().map((row) => ({
      role: row.role as Role,
      permission: row.permission,
      scope: row.scope,
    })),
    skipDuplicates: true,
  });
  await loadPermissionsFromDb(db);
};
