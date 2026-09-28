import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — catálogo de departamentos y subáreas.
 *
 * `departments.manage` es ADMIN (el EMPLEADO no lo tiene). El departamento
 * nace en MAYÚSCULAS; la eliminación es soft la primera vez y física la
 * segunda. Todo se crea con nombre `E2E …` y se borra al terminar.
 */
assertSafeDatabase();

const RUN = newRunId();
const NAME = `${E2E_PREFIX} DEPT ${RUN}`;
const SUB = `${E2E_PREFIX} SUB ${RUN}`;
const OTHER_SUB = `${E2E_PREFIX} SUB2 ${RUN}`;

let deptId = "";

test.afterAll(async () => {
  if (deptId) {
    await db.subarea.deleteMany({ where: { departmentId: deptId } });
    await db.department.deleteMany({ where: { id: deptId } });
  }
});

test.describe("Departamentos (E2E)", () => {
  test("sin token es 401 y EMPLEADO es 403 al crear", async ({ ctxAnonymous, ctxEmployee }) => {
    const body = { name: `${E2E_PREFIX} NO PERMITIDO ${RUN}` };
    expect((await ctxAnonymous.post("departments", { data: body })).status()).toBe(401);
    expect((await ctxEmployee.post("departments", { data: body })).status()).toBe(403);
  });

  test("ADMIN crea el departamento (201) en mayúsculas", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("departments", { data: { name: NAME } });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { id: string; name: string; active: boolean };
    expect(body).toMatchObject({ name: NAME, active: true });
    deptId = body.id;
  });

  test("el nombre repetido es 409 y el inválido 400", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.post("departments", { data: { name: NAME } })).status()).toBe(409);
    expect((await ctxAdmin.post("departments", { data: { name: "a" } })).status()).toBe(400);
  });

  test("el listado es público para cualquier sesión y trae el departamento", async ({
    ctxEmployee,
  }) => {
    const res = await ctxEmployee.get("departments");
    expect(res.status()).toBe(200);
    const list = (await res.json()) as Array<{ id: string; name: string }>;
    expect(list.some((d) => d.id === deptId)).toBe(true);
  });

  test("el detalle trae subáreas, conteo de usuarios y préstamos", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get(`departments/${deptId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: deptId, name: NAME });
    expect(Array.isArray(body.subareas)).toBe(true);
    expect(Array.isArray(body.custodyLetters)).toBe(true);
    expect(typeof body.custodyLettersTotal).toBe("number");
    expect(body._count).toMatchObject({ users: expect.any(Number) });
  });

  test("actualiza el nombre (200)", async ({ ctxAdmin }) => {
    const renamed = `${NAME} 2`;
    const res = await ctxAdmin.put(`departments/${deptId}`, { data: { name: renamed } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).name).toBe(renamed.toUpperCase());

    // Vuelve al nombre original para no alterar las siguientes aserciones.
    await ctxAdmin.put(`departments/${deptId}`, { data: { name: NAME } });
  });

  test("subárea: crear (201), duplicar (409), listar y actualizar", async ({ ctxAdmin }) => {
    const created = await ctxAdmin.post("subareas", { data: { departmentId: deptId, name: SUB } });
    expect(created.status(), await created.text()).toBe(201);
    const sub = (await created.json()) as { id: string; name: string; department: { id: string } };
    expect(sub).toMatchObject({ name: SUB, department: { id: deptId } });

    expect(
      (await ctxAdmin.post("subareas", { data: { departmentId: deptId, name: SUB } })).status()
    ).toBe(409);

    const list = await ctxAdmin.get(`subareas?departmentId=${deptId}`);
    expect(list.status()).toBe(200);
    expect((await list.json()).some((s: { id: string }) => s.id === sub.id)).toBe(true);

    const updated = await ctxAdmin.put(`subareas/${sub.id}`, { data: { name: OTHER_SUB } });
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await updated.json()).name).toBe(OTHER_SUB);
  });

  test("EMPLEADO no puede tocar subáreas (403)", async ({ ctxEmployee }) => {
    expect(
      (await ctxEmployee.post("subareas", { data: { departmentId: deptId, name: "X" } })).status()
    ).toBe(403);
  });

  test("eliminar es soft (active=false) y luego físico", async ({ ctxAdmin }) => {
    const first = await ctxAdmin.delete(`departments/${deptId}`);
    expect(first.status(), await first.text()).toBe(200);
    expect((await first.json()).soft).toBe(true);

    const second = await ctxAdmin.delete(`departments/${deptId}`);
    expect(second.status(), await second.text()).toBe(200);
    expect((await second.json()).soft).toBe(false);

    const gone = await db.department.findUnique({ where: { id: deptId } });
    expect(gone).toBeNull();
    deptId = "";
  });
});
