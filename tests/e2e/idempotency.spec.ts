import { request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { E2E, assertSafeDatabase, newRunId } from "./support/env";
import { db } from "./support/db";
import { InventoryApi, type Movement } from "./support/inventory-api";

/**
 * IDEMPOTENCIA — BLINDAJE.md §0b, §7. `Idempotency-Key` en movimientos,
 * préstamos y devoluciones: la misma petición repetida no duplica nada.
 */
assertSafeDatabase();

const RUN = newRunId();
const PASSWORD = "E2E-Idem-2026!";

const loginContext = async (username: string, password: string): Promise<APIRequestContext> => {
  const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
  const res = await login.post("auth/login", { data: { username, password } });
  if (res.status() !== 200) {
    throw new Error(`No se pudo autenticar "${username}" (${res.status()}): ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  await login.dispose();
  return playwrightRequest.newContext({
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
};

const createManager = async (
  ctx: APIRequestContext,
  suffix: string
): Promise<{ id: string; username: string }> => {
  const username = `e2e_idem_${RUN}_${suffix}`.toLowerCase();
  const res = await ctx.post("users", {
    data: { username, password: PASSWORD, name: `E2E Idem ${RUN}`, role: "MANAGER" },
  });
  if (res.status() !== 201) {
    throw new Error(`No se pudo crear el usuario (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, username };
};

const clearUser = async (id: string): Promise<void> => {
  await db.auditLog.deleteMany({ where: { entityType: "User", entityId: id } });
  await db.user.delete({ where: { id } }).catch(() => {
    /* si quedara una referencia dura, el teardown global lo recoge */
  });
};

test.describe("IDEMPOTENCIA (E2E)", () => {
  test("la misma clave repetida devuelve el mismo préstamo y no duplica", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(5);
    const key = `e2e-idem-${RUN}-repeat`;
    const payload = { departmentId, items: [{ deviceId: device.id, quantity: 2 }] };

    const first = await inv.postWithKey<Movement>("/inventory/loans", key, payload);
    expect(first.status).toBe(201);
    const second = await inv.postWithKey<Movement>("/inventory/loans", key, payload);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, ON_LOAN: 2 });
    expect(await db.movement.count({ where: { requestId: key } })).toBe(1);
    expect(await db.loan.count({ where: { movement: { requestId: key } } })).toBe(1);
  });

  test("tres peticiones concurrentes con la misma clave registran una sola", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(5);
    const key = `e2e-idem-${RUN}-concurrent`;
    const payload = { departmentId, items: [{ deviceId: device.id, quantity: 1 }] };

    const responses = await Promise.all(
      [1, 2, 3].map(() => inv.postWithKey<Movement>("/inventory/loans", key, payload))
    );
    const successes = responses.filter((r) => r.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(successes.map((r) => (r.body as Movement).id));
    expect(ids.size).toBe(1);

    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 4, ON_LOAN: 1 });
    expect(await db.movement.count({ where: { requestId: key } })).toBe(1);
  });

  test("una clave con formato inválido es 400", async ({ inv, scenario, departmentId }) => {
    const device = await scenario.device(2);
    const res = await inv.postWithKey("/inventory/loans", "abc", {
      departmentId,
      items: [{ deviceId: device.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
  });

  test("reutilizar la clave de otro usuario es 409", async ({ ctxAdmin, inv, scenario }) => {
    const manager = await createManager(ctxAdmin, "reuse");
    const ctxManager = await loginContext(manager.username, PASSWORD);
    try {
      const device = await scenario.device(2);
      const key = `e2e-idem-${RUN}-reuse`;
      const payload = {
        type: "MAINTENANCE_IN" as const,
        items: [{ deviceId: device.id, quantity: 1 }],
      };
      const first = await inv.postWithKey<Movement>("/inventory/movements", key, payload);
      expect(first.status).toBe(201);

      const other = new InventoryApi(ctxManager);
      const res = await other.postWithKey("/inventory/movements", key, payload);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    } finally {
      await ctxManager.dispose();
      await clearUser(manager.id);
    }
  });
});
