import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — catálogo de horarios (`/horarios`), con foco en el umbral
 * `minimoExtraMin` (mínimo de tiempo extra para que cuente; 0 = sin mínimo).
 *
 * Todo se crea bajo el prefijo `E2E` y se borra al final por ese prefijo, así
 * que los horarios reales del cliente no se tocan.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const NOMBRE_BASE = `${E2E_PREFIX} Horario ${RUN}`;

const dia = { diaSemana: 1, entrada: "08:00", salida: "17:00" };

const payload = (sufijo: string, extra: Record<string, unknown> = {}) => ({
  nombre: `${NOMBRE_BASE} ${sufijo}`,
  dias: [dia],
  ...extra,
});

test.afterAll(async () => {
  await db.horario.deleteMany({ where: { nombre: { startsWith: NOMBRE_BASE } } });
});

test.describe("Horarios — mínimo de horas extra (E2E)", () => {
  test("POST sin minimoExtraMin crea con 60 por defecto", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("horarios", { data: payload("default") });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { minimoExtraMin: number };
    expect(body.minimoExtraMin).toBe(60);
  });

  test("POST con minimoExtraMin 0 respeta 0 (sin mínimo)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("horarios", { data: payload("cero", { minimoExtraMin: 0 }) });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { minimoExtraMin: number };
    expect(body.minimoExtraMin).toBe(0);
  });

  test("POST rechaza minimoExtraMin inválido (-1, 1441, no entero)", async ({ ctxAdmin }) => {
    for (const value of [-1, 1441, 1.5]) {
      const res = await ctxAdmin.post("horarios", {
        data: payload(`bad-${String(value).replace(".", "_")}`, { minimoExtraMin: value }),
      });
      expect(res.status(), `minimoExtraMin=${value}`).toBe(400);
    }
  });

  test("PATCH { activo } no altera minimoExtraMin; PATCH { minimoExtraMin: 0 } sí", async ({
    ctxAdmin,
  }) => {
    const creado = await ctxAdmin.post("horarios", { data: payload("patch") });
    expect(creado.status(), await creado.text()).toBe(201);
    const { id } = (await creado.json()) as { id: string };

    // El toggle de activo manda solo `{ activo }`: no debe resetear el campo.
    const toggle = await ctxAdmin.patch(`horarios/${id}`, { data: { activo: false } });
    expect(toggle.status(), await toggle.text()).toBe(200);
    const toggleBody = (await toggle.json()) as { minimoExtraMin: number; activo: boolean };
    expect(toggleBody).toMatchObject({ minimoExtraMin: 60, activo: false });

    const setCero = await ctxAdmin.patch(`horarios/${id}`, { data: { minimoExtraMin: 0 } });
    expect(setCero.status(), await setCero.text()).toBe(200);
    const ceroBody = (await setCero.json()) as { minimoExtraMin: number };
    expect(ceroBody.minimoExtraMin).toBe(0);

    const enBase = await db.horario.findUnique({
      where: { id },
      select: { minimoExtraMin: true },
    });
    expect(enBase?.minimoExtraMin).toBe(0);
  });

  test("permisos: anónimo 401; sin rol de escritura 403", async ({
    ctxAdmin,
    ctxEmpleado,
    ctxGuard,
    ctxAnonimo,
  }) => {
    expect((await ctxAnonimo.post("horarios", { data: payload("anon") })).status()).toBe(401);
    expect((await ctxEmpleado.post("horarios", { data: payload("emp") })).status()).toBe(403);
    expect((await ctxGuard.post("horarios", { data: payload("guard") })).status()).toBe(403);

    const creado = await ctxAdmin.post("horarios", { data: payload("perm") });
    expect(creado.status(), await creado.text()).toBe(201);
    const { id } = (await creado.json()) as { id: string };

    expect((await ctxAnonimo.patch(`horarios/${id}`, { data: { activo: false } })).status()).toBe(401);
    expect((await ctxEmpleado.patch(`horarios/${id}`, { data: { activo: false } })).status()).toBe(403);
    expect((await ctxGuard.patch(`horarios/${id}`, { data: { activo: false } })).status()).toBe(403);
  });
});
