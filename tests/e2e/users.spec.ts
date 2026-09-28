import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — usuarios (`/users`): alta, consulta, historial, edición,
 * contraseña y borrado (soft y físico).
 *
 * `users.view`/`users.create`/`users.edit`/`users.delete` son de ADMIN; el
 * EMPLEADO recibe 403. Los usuarios creados se borran aquí, junto con sus
 * rastros (notificaciones, cola de correo y bitácora).
 */
assertSafeDatabase();

const RUN = newRunId();
const U1 = `e2e_user_${RUN}_a`.toLowerCase();
const U2 = `e2e_user_${RUN}_b`.toLowerCase();
const NAME = `${E2E_PREFIX} Usuario ${RUN}`;

let userId = "";

const cleanupUser = async (username: string) => {
  const user = await db.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) return;
  await db.notification.deleteMany({ where: { userId: user.id } });
  await db.emailLog.deleteMany({ where: { entityId: user.id } });
  await db.emailLog.deleteMany({ where: { subject: { contains: username } } });
  await db.auditLog.deleteMany({ where: { entityId: user.id } });
  await db.user.deleteMany({ where: { id: user.id } });
};

test.afterAll(async () => {
  await cleanupUser(U1);
  await cleanupUser(U2);
});

test.describe("Usuarios (E2E)", () => {
  test("sin token es 401 y EMPLEADO es 403 al listar", async ({ ctxAnonymous, ctxEmployee }) => {
    expect((await ctxAnonymous.get("users")).status()).toBe(401);
    expect((await ctxEmployee.get("users")).status()).toBe(403);
    expect((await ctxEmployee.post("users", { data: {} })).status()).toBe(403);
  });

  test("ADMIN lista (200) y crea (201); el username repetido es 409", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.get("users")).status()).toBe(200);

    const created = await ctxAdmin.post("users", {
      data: { username: U1, password: "secreto123", name: NAME, role: "EMPLOYEE" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = (await created.json()) as { id: string; username: string; role: string };
    expect(body).toMatchObject({ username: U1, role: "EMPLOYEE" });
    userId = body.id;

    const dup = await ctxAdmin.post("users", {
      data: { username: U1, password: "secreto123", name: NAME, role: "EMPLOYEE" },
    });
    expect(dup.status()).toBe(409);
  });

  test("valida el body (400)", async ({ ctxAdmin }) => {
    expect(
      (
        await ctxAdmin.post("users", {
          data: { username: U2, password: "123", name: NAME, role: "EMPLOYEE" },
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await ctxAdmin.post("users", {
          data: { username: "ab", password: "secreto123", name: NAME, role: "EMPLOYEE" },
        })
      ).status()
    ).toBe(400);
  });

  test("detalle (200) e historial (200) del usuario", async ({ ctxAdmin }) => {
    const one = await ctxAdmin.get(`users/${userId}`);
    expect(one.status()).toBe(200);
    expect(await one.json()).toMatchObject({ id: userId, username: U1 });

    const history = await ctxAdmin.get(`users/${userId}/history`);
    expect(history.status()).toBe(200);
    expect(Array.isArray(await history.json())).toBe(true);
  });

  test("el directorio de empleados y la tabla son accesibles con sesión", async ({ ctxEmployee }) => {
    const employees = await ctxEmployee.get("users/employees");
    expect(employees.status()).toBe(200);
    expect(Array.isArray(await employees.json())).toBe(true);

    const table = await ctxEmployee.post("users/query", {
      data: { page: 1, limit: 5, filters: {}, sort: { key: "name", direction: "asc" } },
    });
    expect(table.status(), await table.text()).toBe(200);
    const body = (await table.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("edita el usuario (200) y cambia la contraseña (204)", async ({ ctxAdmin }) => {
    const updated = await ctxAdmin.put(`users/${userId}`, { data: { jobTitle: "E2E Puesto" } });
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await updated.json()).jobTitle).toBe("E2E Puesto");

    const pwd = await ctxAdmin.put(`users/${userId}/password`, { data: { password: "otraClave123" } });
    expect(pwd.status()).toBe(204);
  });

  test("borrado: soft y luego físico", async ({ ctxAdmin }) => {
    const first = await ctxAdmin.delete(`users/${userId}`);
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = (await first.json()) as { soft: boolean };
    expect(firstBody.soft).toBe(true);

    const second = await ctxAdmin.delete(`users/${userId}`);
    expect(second.status(), await second.text()).toBe(200);
    expect((await second.json()).soft).toBe(false);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    userId = "";
  });
});
