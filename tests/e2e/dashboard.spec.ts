import { test, expect } from "./support/fixtures";
import { assertSafeDatabase } from "./support/env";

/**
 * E2E de contrato — resumen del inicio (`GET /dashboard/summary`), protegido por
 * `dashboard.view` (ADMIN y MANAGER; no EMPLEADO).
 */
assertSafeDatabase();

test.describe("Dashboard — resumen (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("dashboard/summary")).status()).toBe(401);
  });

  test("EMPLEADO sin dashboard.view es 403", async ({ ctxEmployee }) => {
    expect((await ctxEmployee.get("dashboard/summary")).status()).toBe(403);
  });

  test("ADMIN recibe los bloques del resumen", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("dashboard/summary");
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.devices).toMatchObject({
      total: expect.any(Number),
      available: expect.any(Number),
      assigned: expect.any(Number),
      retirement: expect.any(Number),
    });
    expect(body.tickets).toMatchObject({
      total: expect.any(Number),
      open: expect.any(Number),
      inProgress: expect.any(Number),
      closed: expect.any(Number),
    });
    expect(body.custodyLetters).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
    });
    expect(body.materialOutputs).toMatchObject({
      total: expect.any(Number),
      damaged: expect.any(Number),
    });
    expect(body.departments).toEqual(expect.any(Number));
    expect(body.employees).toEqual(expect.any(Number));
    expect(body.ticketMetrics).toMatchObject({
      resolvedTasks: expect.any(Number),
      pendingTasks: expect.any(Number),
    });

    for (const key of ["ticketEfficiency", "urgentTickets", "recentActivity"]) {
      expect(Array.isArray(body[key]), `${key} debe ser arreglo`).toBe(true);
    }
  });
});
