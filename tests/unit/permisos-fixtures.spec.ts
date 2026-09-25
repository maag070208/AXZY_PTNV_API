import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loadPermisosFixture, loadRolPermisosFixture } from "../../src/core/permisos";

/**
 * Valida los fixtures del catálogo y la matriz, y los guardas anti-drift:
 * la migración SQL debe declarar las mismas claves que `permisos.json`, y toda
 * clave usada en las rutas (`requierePermiso("...")`) debe existir en el
 * catálogo. Sin BD.
 */

const API_ROOT = path.resolve(__dirname, "..", "..");

const ALCANCES = ["NINGUNO", "PROPIO", "AREA", "TODO"] as const;
const ROLES = [
  "ADMIN",
  "GERENTE",
  "JEFE_DE_AREA",
  "EMPLEADO",
  "RECURSOS_HUMANOS",
  "GUARD",
] as const;

const catalogo = loadPermisosFixture();
const claves = new Set(catalogo.map((p) => p.clave));

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
};

test.describe("permisos.json", () => {
  test("tiene 44 claves únicas y bien formadas", () => {
    expect(catalogo).toHaveLength(44);
    expect(claves.size).toBe(44);

    for (const permiso of catalogo) {
      expect(permiso.clave, permiso.clave).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(permiso.modulo.length, permiso.clave).toBeGreaterThan(0);
      expect(permiso.nombre.length, permiso.clave).toBeGreaterThan(0);
      expect(Array.isArray(permiso.alcances), permiso.clave).toBe(true);
      expect(permiso.alcances.length, permiso.clave).toBeGreaterThan(0);
      for (const alcance of permiso.alcances) {
        expect(ALCANCES, `${permiso.clave} / ${alcance}`).toContain(alcance);
      }
      expect(typeof permiso.sensible, permiso.clave).toBe("boolean");
      expect(Number.isInteger(permiso.orden), permiso.clave).toBe(true);
    }
  });
});

test.describe("rol_permisos.json", () => {
  const filas = loadRolPermisosFixture();
  const porClave = new Map(catalogo.map((p) => [p.clave, p]));

  test("cada fila tiene rol, permiso y alcance válidos", () => {
    expect(filas.length).toBeGreaterThan(0);

    for (const fila of filas) {
      expect(ROLES as readonly string[], `${fila.rol}`).toContain(fila.rol);

      const definicion = porClave.get(fila.permiso);
      expect(definicion, `permiso ${fila.permiso}`).toBeDefined();

      const validos = new Set<string>([...(definicion?.alcances ?? []), "NINGUNO"]);
      expect(validos.has(fila.alcance), `${fila.rol} / ${fila.permiso}`).toBe(true);
    }
  });

  test("no hay pares rol+permiso duplicados", () => {
    const pares = filas.map((f) => `${f.rol}|${f.permiso}`);
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

    const bloque = sql.slice(start, end);
    const clavesMigracion = [...bloque.matchAll(/\('([^']+)',/g)].map((m) => m[1]);

    expect(new Set(clavesMigracion)).toEqual(claves);
  });
});

test.describe("guard de call sites", () => {
  test("toda clave usada en requierePermiso existe en el catálogo", () => {
    const modulesDir = path.join(API_ROOT, "src", "modules");
    const routeFiles = walk(modulesDir).filter((file) =>
      file.includes(`${path.sep}routes${path.sep}`)
    );
    expect(routeFiles.length).toBeGreaterThan(0);

    const usadas: string[] = [];
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, "utf-8");
      for (const match of source.matchAll(/requierePermiso\("([^"]+)"\)/g)) {
        usadas.push(match[1]);
      }
    }

    expect(usadas.length).toBeGreaterThan(0);
    for (const clave of usadas) {
      expect(claves.has(clave), `"${clave}" usada en rutas pero ausente del catálogo`).toBe(true);
    }
  });
});
