import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loadPermissionsFixture, loadRolePermissionsFixture } from "../../src/core/permissions";

/**
 * Valida los fixtures del catálogo y la matriz, y los guardas anti-drift:
 * la migración SQL debe declarar las mismas claves que `permissions.json`, y toda
 * clave usada en las rutas (`requiresPermission("...")`) debe existir en el
 * catálogo. Sin BD.
 */

const API_ROOT = path.resolve(__dirname, "..", "..");

const SCOPES = ["NONE", "OWN", "AREA", "ALL"] as const;
const ROLES = [
  "ADMIN",
  "MANAGER",
  "AREA_HEAD",
  "EMPLOYEE",
  "HUMAN_RESOURCES",
  "GUARD",
] as const;

const catalog = loadPermissionsFixture();
const keys = new Set(catalog.map((p) => p.key));

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
};

test.describe("permissions.json", () => {
  test("tiene 44 claves únicas y bien formadas", () => {
    expect(catalog).toHaveLength(44);
    expect(keys.size).toBe(44);

    for (const permission of catalog) {
      expect(permission.key, permission.key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(permission.module.length, permission.key).toBeGreaterThan(0);
      expect(permission.name.length, permission.key).toBeGreaterThan(0);
      expect(Array.isArray(permission.scopes), permission.key).toBe(true);
      expect(permission.scopes.length, permission.key).toBeGreaterThan(0);
      for (const scope of permission.scopes) {
        expect(SCOPES, `${permission.key} / ${scope}`).toContain(scope);
      }
      expect(typeof permission.sensitive, permission.key).toBe("boolean");
      expect(Number.isInteger(permission.sortOrder), permission.key).toBe(true);
    }
  });
});

test.describe("role_permissions.json", () => {
  const rows = loadRolePermissionsFixture();
  const byKey = new Map(catalog.map((p) => [p.key, p]));

  test("cada fila tiene rol, permiso y alcance válidos", () => {
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(ROLES as readonly string[], `${row.role}`).toContain(row.role);

      const definition = byKey.get(row.permission);
      expect(definition, `permiso ${row.permission}`).toBeDefined();

      const valid = new Set<string>([...(definition?.scopes ?? []), "NONE"]);
      expect(valid.has(row.scope), `${row.role} / ${row.permission}`).toBe(true);
    }
  });

  test("no hay pares rol+permiso duplicados", () => {
    const pares = rows.map((f) => `${f.role}|${f.permission}`);
    expect(new Set(pares).size).toBe(pares.length);
  });
});

test.describe("guard anti-drift de la migración", () => {
  test("la migración del catálogo declara el mismo set de claves", () => {
    const migrationsDir = path.join(API_ROOT, "prisma", "migrations");
    const dir = fs
      .readdirSync(migrationsDir)
      .find((name) => name.endsWith("_permisos_catalogo"));
    expect(dir, "migración *_permisos_catalogo").toBeDefined();

    const sql = fs.readFileSync(path.join(migrationsDir, dir as string, "migration.sql"), "utf-8");
    const start = sql.indexOf('INSERT INTO "permisos"');
    const end = sql.indexOf('ON CONFLICT ("clave") DO NOTHING');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const block = sql.slice(start, end);
    const seededKeys = [...block.matchAll(/\('([^']+)',/g)].map((m) => m[1]);

    // La migración english_names renombra esas claves a inglés con un UPDATE
    // (CASE "key" WHEN '<vieja>' THEN '<nueva>').
    const englishDir = fs.readdirSync(migrationsDir).find((name) => name.endsWith("_english_names"));
    expect(englishDir, "migración *_english_names").toBeDefined();
    const englishSql = fs.readFileSync(path.join(migrationsDir, englishDir as string, "migration.sql"), "utf-8");
    const updateStart = englishSql.indexOf('UPDATE "permissions" SET "key"');
    expect(updateStart).toBeGreaterThan(-1);
    const updateBlock = englishSql.slice(updateStart, englishSql.indexOf(";", updateStart));
    const renamed = new Map([...updateBlock.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]));
    const migrationKeys = seededKeys.map((k) => renamed.get(k) ?? k);

    expect(new Set(migrationKeys)).toEqual(keys);
  });
});

test.describe("guard de call sites", () => {
  test("toda clave usada en requiresPermission existe en el catálogo", () => {
    const modulesDir = path.join(API_ROOT, "src", "modules");
    const routeFiles = walk(modulesDir).filter((file) =>
      file.includes(`${path.sep}routes${path.sep}`)
    );
    expect(routeFiles.length).toBeGreaterThan(0);

    const used: string[] = [];
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, "utf-8");
      for (const match of source.matchAll(/requiresPermission\("([^"]+)"\)/g)) {
        used.push(match[1]);
      }
    }

    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(keys.has(key), `"${key}" usada en rutas pero ausente del catálogo`).toBe(true);
    }
  });
});
