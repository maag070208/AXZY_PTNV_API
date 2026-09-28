import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — permisos: catálogo y matriz rol → permiso → alcance.
 *
 * `roles.manage` es solo de ADMIN. El test crea un permiso propio
 * (`e2e.test_<run>`), lo mapea a EMPLOYEE en la matriz, verifica el guard
 * anti-lockout del ADMIN y limpia todo al terminar (el cache se recarga con
 * `POST /permissions/reload`).
 */
assertSafeDatabase();

const RUN = newRunId();
const KEY = `e2e.test_${RUN.toLowerCase()}`;

test.afterAll(async ({ ctxAdmin }) => {
  await db.rolePermission.deleteMany({ where: { permission: KEY } });
  await db.permission.deleteMany({ where: { key: KEY } });
  // El cache de permisos se recarga tras un cambio por API; el borrado directo
  // en la base no lo dispara, así que se fuerza.
  await ctxAdmin.post("permissions/reload", { data: {} });
});

test.describe("Permisos y roles (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("permissions/catalog")).status()).toBe(401);
    expect((await ctxAnonymous.get("permissions/admin")).status()).toBe(401);
  });

  test("el catálogo es visible para cualquier sesión; admin solo para roles.manage", async ({
    ctxAdmin,
    ctxEmployee,
  }) => {
    const catalog = await ctxEmployee.get("permissions/catalog");
    expect(catalog.status()).toBe(200);
    expect(Array.isArray(await catalog.json())).toBe(true);

    expect((await ctxEmployee.get("permissions/admin")).status()).toBe(403);

    const admin = await ctxAdmin.get("permissions/admin");
    expect(admin.status(), await admin.text()).toBe(200);
    const body = (await admin.json()) as {
      roles: string[];
      catalog: Array<{ key: string }>;
      matrix: Array<{ role: string; permission: string; scope: string }>;
    };
    expect(body.roles).toContain("ADMIN");
    expect(body.catalog.some((p) => p.key === "roles.manage")).toBe(true);
    expect(body.matrix.some((m) => m.permission === "roles.manage" && m.role === "ADMIN")).toBe(true);
  });

  test("crea un permiso propio (201) y rechaza clave/matriz inválidas", async ({ ctxAdmin, ctxEmployee }) => {
    expect(
      (
        await ctxEmployee.post("permissions/catalog", {
          data: { key: KEY, module: "E2E", name: "E2E", scopes: ["ALL"] },
        })
      ).status()
    ).toBe(403);

    const created = await ctxAdmin.post("permissions/catalog", {
      data: {
        key: KEY,
        module: "E2E",
        name: `${E2E_PREFIX} Permiso ${RUN}`,
        description: "permiso de prueba",
        scopes: ["NONE", "ALL"],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    expect((await created.json()).key).toBe(KEY);

    // Clave mal formada.
    expect(
      (
        await ctxAdmin.post("permissions/catalog", {
          data: { key: "Mal Formada", module: "E2E", name: "x", scopes: ["ALL"] },
        })
      ).status()
    ).toBe(400);

    // Sin cambios: 400.
    expect((await ctxAdmin.put("permissions/matrix", { data: {} })).status()).toBe(400);
  });

  test("actualiza el permiso del catálogo (200)", async ({ ctxAdmin }) => {
    const patch = await ctxAdmin.patch(`permissions/catalog/${KEY}`, {
      data: { name: `${E2E_PREFIX} Permiso ${RUN} (editado)` },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await patch.json()).name).toContain("(editado)");
  });

  test("asigna el permiso a EMPLEADO en la matriz y lo refleja en /admin", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put("permissions/matrix", {
      data: { changes: [{ role: "EMPLOYEE", permission: KEY, scope: "ALL" }] },
    });
    expect(res.status(), await res.text()).toBe(200);

    const admin = (await (await ctxAdmin.get("permissions/admin")).json()) as {
      matrix: Array<{ role: string; permission: string; scope: string }>;
    };
    expect(
      admin.matrix.some((m) => m.role === "EMPLOYEE" && m.permission === KEY && m.scope === "ALL")
    ).toBe(true);
  });

  test("guard anti-lockout: ADMIN no puede quedarse sin roles.manage", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put("permissions/matrix", {
      data: { changes: [{ role: "ADMIN", permission: "roles.manage", scope: "NONE" }] },
    });
    expect(res.status()).toBe(409);
  });

  test("recarga los caches (200)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("permissions/reload", { data: {} });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
