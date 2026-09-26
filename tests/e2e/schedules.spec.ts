import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — catálogo de horarios (`/horarios`), con foco en el umbral
 * `minimoExtraMin` (mínimo de tiempo extra para que cuente; 0 = sin mínimo).
 *
 * Todo se crea bajo el prefijo `E2E` y se borra al final por ese prefijo, así
 * que los horarios reales del cliente no se tocan.
 */
assertSafeDatabase();

const RUN = newRunId();
const NAME_BASE = `${E2E_PREFIX} Horario ${RUN}`;

const day = { weekday: 1, startTime: "08:00", endTime: "17:00" };

const payload = (suffix: string, extra: Record<string, unknown> = {}) => ({
  name: `${NAME_BASE} ${suffix}`,
  days: [day],
  ...extra,
});

test.afterAll(async () => {
  await db.schedule.deleteMany({ where: { name: { startsWith: NAME_BASE } } });
});

test.describe("Horarios — mínimo de horas extra (E2E)", () => {
  test("POST sin minimoExtraMin crea con 60 por defecto", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules", { data: payload("default") });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { minOvertimeMin: number };
    expect(body.minOvertimeMin).toBe(60);
  });

  test("POST con minimoExtraMin 0 respeta 0 (sin mínimo)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules", { data: payload("zero", { minOvertimeMin: 0 }) });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { minOvertimeMin: number };
    expect(body.minOvertimeMin).toBe(0);
  });

  test("POST rechaza minimoExtraMin inválido (-1, 1441, no entero)", async ({ ctxAdmin }) => {
    for (const value of [-1, 1441, 1.5]) {
      const res = await ctxAdmin.post("schedules", {
        data: payload(`bad-${String(value).replace(".", "_")}`, { minOvertimeMin: value }),
      });
      expect(res.status(), `minimoExtraMin=${value}`).toBe(400);
    }
  });

  test("PATCH { activo } no altera minimoExtraMin; PATCH { minimoExtraMin: 0 } sí", async ({
    ctxAdmin,
  }) => {
    const created = await ctxAdmin.post("schedules", { data: payload("patch") });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // El toggle de activo manda solo `{ activo }`: no debe resetear el campo.
    const toggle = await ctxAdmin.patch(`schedules/${id}`, { data: { active: false } });
    expect(toggle.status(), await toggle.text()).toBe(200);
    const toggleBody = (await toggle.json()) as { minOvertimeMin: number; active: boolean };
    expect(toggleBody).toMatchObject({ minOvertimeMin: 60, active: false });

    const setZero = await ctxAdmin.patch(`schedules/${id}`, { data: { minOvertimeMin: 0 } });
    expect(setZero.status(), await setZero.text()).toBe(200);
    const zeroBody = (await setZero.json()) as { minOvertimeMin: number };
    expect(zeroBody.minOvertimeMin).toBe(0);

    const inDb = await db.schedule.findUnique({
      where: { id },
      select: { minOvertimeMin: true },
    });
    expect(inDb?.minOvertimeMin).toBe(0);
  });

  test("permisos: anónimo 401; sin rol de escritura 403", async ({
    ctxAdmin,
    ctxEmployee,
    ctxGuard,
    ctxAnonymous,
  }) => {
    expect((await ctxAnonymous.post("schedules", { data: payload("anon") })).status()).toBe(401);
    expect((await ctxEmployee.post("schedules", { data: payload("emp") })).status()).toBe(403);
    expect((await ctxGuard.post("schedules", { data: payload("guard") })).status()).toBe(403);

    const created = await ctxAdmin.post("schedules", { data: payload("perm") });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect((await ctxAnonymous.patch(`schedules/${id}`, { data: { active: false } })).status()).toBe(401);
    expect((await ctxEmployee.patch(`schedules/${id}`, { data: { active: false } })).status()).toBe(403);
    expect((await ctxGuard.patch(`schedules/${id}`, { data: { active: false } })).status()).toBe(403);
  });
});
