import type { APIRequestContext } from "@playwright/test";
import type { MetodoChecada } from "@prisma/client";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — checadas del reloj Hikvision (`/checador`). Ver CHECADOR.md.
 *
 * Las checadas solo entran por la sincronización con el reloj, que aquí NO se
 * dispara (la suite no depende del equipo). Se siembran con Prisma bajo una
 * serie de dispositivo propia `E2E-CHK-<run>` y se borran al final; las
 * checadas reales que ya estén en la base no se tocan y cada consulta filtra
 * por los números de empleado de esta corrida.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const SERIE = `${E2E_PREFIX}-CHK-${RUN}`;
const EMP_A = `${E2E_PREFIX}${RUN}A`;
const EMP_B = `${E2E_PREFIX}${RUN}B`;
let serial = 0;

const sembrar = async (
  numeroEmpleado: string,
  metodo: MetodoChecada,
  occurredAt: string,
  nombre = `E2E Checada ${RUN} ${numeroEmpleado}`
): Promise<void> => {
  await db.checada.create({
    data: {
      dispositivoSerie: SERIE,
      serialNo: ++serial,
      numeroEmpleado,
      nombre,
      metodo,
      minor: metodo === "HUELLA" ? 38 : 75,
      occurredAt: new Date(occurredAt),
    },
  });
};

interface Pagina {
  total: number;
  data: Array<{ numeroEmpleado: string; metodo: string; occurredAt: string; serialNo: number }>;
}

const consultar = async (
  ctx: APIRequestContext,
  filters: Record<string, string>
): Promise<Pagina> => {
  const res = await ctx.post("checador/query", { data: { page: 1, limit: 50, filters } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Pagina;
};

test.beforeAll(async () => {
  // A: rostro el 10 y el 12 de marzo, y una checada a las 22:00 del 10 en
  // Tijuana que en UTC ya es el 11. B: huella el 11.
  await sembrar(EMP_A, "ROSTRO", "2026-03-10T08:00:00Z");
  await sembrar(EMP_A, "ROSTRO", "2026-03-11T05:00:00Z");
  await sembrar(EMP_B, "HUELLA", "2026-03-11T15:00:00Z");
  await sembrar(EMP_A, "ROSTRO", "2026-03-12T23:30:00Z");
});

test.afterAll(async () => {
  await db.checada.deleteMany({ where: { dispositivoSerie: SERIE } });
});

test.describe("Checador — checadas del reloj (E2E)", () => {
  test("sin token 401; EMPLEADO/GUARD 403 en consulta, estado, importación y sincronización", async ({
    ctxAnonimo,
    ctxEmpleado,
    ctxGuard,
  }) => {
    expect((await ctxAnonimo.post("checador/query", { data: {} })).status()).toBe(401);
    expect((await ctxEmpleado.post("checador/query", { data: {} })).status()).toBe(403);
    expect((await ctxEmpleado.get("checador/status")).status()).toBe(403);
    expect((await ctxEmpleado.post("checador/import", { data: {} })).status()).toBe(403);
    // El drenado solo lo arranca quien consulta el reloj (solo LEE del equipo).
    expect((await ctxAnonimo.post("checador/sync")).status()).toBe(401);
    expect((await ctxEmpleado.post("checador/sync")).status()).toBe(403);
    expect((await ctxGuard.post("checador/sync")).status()).toBe(403);
  });

  // Solo casos inválidos: uno válido arrancaría una importación real contra el reloj.
  test("la importación valida el rango antes de tocar el reloj", async ({ ctxAdmin }) => {
    const alReves = await ctxAdmin.post("checador/import", {
      data: { desde: "2026-03-12", hasta: "2026-03-10" },
    });
    expect(alReves.status()).toBe(400);
    expect(await alReves.json()).toMatchObject({ code: "INVALID_RANGE" });

    const sinFormato = await ctxAdmin.post("checador/import", {
      data: { desde: "10/03/2026", hasta: "2026-03-12" },
    });
    expect(sinFormato.status()).toBe(400);

    const zonaInvalida = await ctxAdmin.post("checador/import", {
      data: { desde: "2026-03-10", hasta: "2026-03-12", tz: "Marte/Olympus" },
    });
    expect(zonaInvalida.status()).toBe(400);
    expect(await zonaInvalida.json()).toMatchObject({ code: "INVALID_TIMEZONE" });
  });

  test("la tabla devuelve las checadas más recientes primero", async ({ ctxAdmin }) => {
    const pagina = await consultar(ctxAdmin, { q: `E2E Checada ${RUN}` });
    expect(pagina.total).toBe(4);
    expect(pagina.data.map((c) => c.occurredAt)).toEqual([
      "2026-03-12T23:30:00.000Z",
      "2026-03-11T15:00:00.000Z",
      "2026-03-11T05:00:00.000Z",
      "2026-03-10T08:00:00.000Z",
    ]);
  });

  test("filtra por número de empleado exacto y por método", async ({ ctxAdmin }) => {
    const deA = await consultar(ctxAdmin, { numeroEmpleado: EMP_A });
    expect(deA.total).toBe(3);
    expect(deA.data.every((c) => c.numeroEmpleado === EMP_A)).toBe(true);

    const huellas = await consultar(ctxAdmin, { q: `E2E Checada ${RUN}`, metodo: "HUELLA" });
    expect(huellas.total).toBe(1);
    expect(huellas.data[0]).toMatchObject({ numeroEmpleado: EMP_B, metodo: "HUELLA" });
  });

  test("desde/hasta son días locales de la zona indicada, con `hasta` inclusive", async ({ ctxAdmin }) => {
    const base = { q: `E2E Checada ${RUN}` };

    const utc = await consultar(ctxAdmin, { ...base, desde: "2026-03-10", hasta: "2026-03-10", tz: "UTC" });
    expect(utc.data.map((c) => c.occurredAt)).toEqual(["2026-03-10T08:00:00.000Z"]);

    // 2026-03-11T05:00Z son las 22:00 del día 10 en Tijuana (UTC-7).
    const tijuana = await consultar(ctxAdmin, {
      ...base,
      desde: "2026-03-10",
      hasta: "2026-03-10",
      tz: "America/Tijuana",
    });
    expect(tijuana.data.map((c) => c.occurredAt)).toEqual([
      "2026-03-11T05:00:00.000Z",
      "2026-03-10T08:00:00.000Z",
    ]);

    const rango = await consultar(ctxAdmin, { ...base, desde: "2026-03-10", hasta: "2026-03-11", tz: "UTC" });
    expect(rango.total).toBe(3);
  });

  test("un método desconocido es 400", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("checador/query", { data: { filters: { metodo: "IRIS" } } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_METODO" });
  });

  test("el estado reporta la configuración y los equipos sincronizados", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("checador/status");
    expect(res.status()).toBe(200);
    const status = (await res.json()) as Record<string, unknown>;
    expect(typeof status.configurado).toBe("boolean");
    expect(typeof status.pausadoPorCredenciales).toBe("boolean");
    expect(Array.isArray(status.dispositivos)).toBe(true);
  });
});

/**
 * Vínculos reloj ↔ usuario y entradas/salidas del reloj (`/checador/report`).
 *
 * El reloj no dice si una checada es entrada o salida: se alternan, las
 * repetidas (< 5 min) se ignoran, `OTRO` no cuenta y el tope de jornada es 13 h.
 * La persona se crea aquí con un nombre propio (para la sugerencia por nombre)
 * y se borra al final junto con sus vínculos y su bitácora.
 */
test.describe("Checador — vínculos y entradas/salidas (E2E)", () => {
  const NUM = `${E2E_PREFIX}${RUN}V`;
  const NUM_LIBRE = `${E2E_PREFIX}${RUN}L`;
  const NOMBRE_SISTEMA = "Ximena Yolotl Zuazua Checador";
  const NOMBRE_RELOJ = "ZUAZUA CHECADOR XIMENA YOLOTL";
  const NOMBRE_LIBRE = `E2E Reloj Libre ${RUN}`;
  const reporte = (ctx: APIRequestContext, date: string, q: string) =>
    ctx.post("checador/report", {
      data: { page: 1, limit: 50, filters: { period: "DAY", date, tz: "UTC", q }, sort: { key: "entryAt", direction: "asc" } },
    });
  let persona: { id: string; name: string };

  test.beforeAll(async () => {
    await db.user.deleteMany({ where: { username: { startsWith: "e2e_checador_" } } });
    persona = await db.user.create({
      data: {
        username: `e2e_checador_${RUN}`.toLowerCase(),
        name: NOMBRE_SISTEMA,
        role: "EMPLEADO",
        password: "!sin-login",
      },
      select: { id: true, name: true },
    });

    // Día 1: 08:00 + repetida 08:02 + 17:00 → una jornada de 9 h; la de `OTRO`
    // (12:00) no cuenta. Turno nocturno 22:00 → 06:00 del día 2 (se atribuye al
    // día 1). Día 2: 12:00 suelta → entrada sin salida.
    await sembrar(NUM, "ROSTRO", "2026-03-10T08:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "ROSTRO", "2026-03-10T08:02:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "OTRO", "2026-03-10T12:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "HUELLA", "2026-03-10T17:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "ROSTRO", "2026-03-10T22:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "ROSTRO", "2026-03-11T06:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM, "ROSTRO", "2026-03-11T12:00:00Z", NOMBRE_RELOJ);
    await sembrar(NUM_LIBRE, "HUELLA", "2026-03-10T09:00:00Z", NOMBRE_LIBRE);
    await sembrar(NUM_LIBRE, "HUELLA", "2026-03-10T18:00:00Z", NOMBRE_LIBRE);
  });

  test.afterAll(async () => {
    await db.checadorEmpleado.deleteMany({ where: { numeroEmpleado: { in: [NUM, NUM_LIBRE] } } });
    await db.auditLog.deleteMany({
      where: { entityType: "ChecadorEmpleado", entityId: { in: [NUM, NUM_LIBRE] } },
    });
    await db.user.deleteMany({ where: { id: persona.id } });
  });

  test("sugiere a la persona por nombre (en otro orden) y solo ADMIN/RH vinculan", async ({
    ctxAdmin,
    ctxEmpleado,
  }) => {
    const res = await ctxAdmin.post("checador/empleados/query", { data: { filters: { q: NUM } } });
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(data).toHaveLength(1);
    // El número del reloj no es numérico → solo coincide el nombre: MEDIA.
    expect(data[0]).toMatchObject({
      numeroEmpleado: NUM,
      nombre: NOMBRE_RELOJ,
      checadas: 7,
      vinculo: null,
      sugerencia: { userId: persona.id, confianza: "MEDIA" },
    });

    const sinPermiso = await ctxEmpleado.put(`checador/empleados/${NUM}`, { data: { userId: persona.id } });
    expect(sinPermiso.status()).toBe(403);
    const inexistente = await ctxAdmin.put(`checador/empleados/${NUM}`, { data: { userId: "no-existe" } });
    expect(inexistente.status()).toBe(404);
  });

  test("vinculada, sus checadas se emparejan en jornadas del día de la entrada", async ({ ctxAdmin }) => {
    const vinculo = await ctxAdmin.put(`checador/empleados/${NUM}`, { data: { userId: persona.id } });
    expect(vinculo.status()).toBe(200);
    expect(await vinculo.json()).toMatchObject({ vinculo: { userId: persona.id } });

    const dia1 = (await (await reporte(ctxAdmin, "2026-03-10", NOMBRE_SISTEMA)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(dia1.data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T17:00:00.000Z", 540, null],
      ["2026-03-10T22:00:00.000Z", "2026-03-11T06:00:00.000Z", 480, null],
    ]);
    expect(dia1.data[0]).toMatchObject({ employeeId: persona.id, employeeName: NOMBRE_SISTEMA, vinculado: true });
    expect(dia1.data[1]).toMatchObject({ crossesMidnight: true });

    const dia2 = (await (await reporte(ctxAdmin, "2026-03-11", NOMBRE_SISTEMA)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(dia2.data).toHaveLength(1);
    expect(dia2.data[0]).toMatchObject({
      entryAt: "2026-03-11T12:00:00.000Z",
      exitAt: null,
      incident: "ENTRY_WITHOUT_EXIT",
    });
  });

  test("quien checa sin vincular sale con el nombre del reloj; al desvincular, igual", async ({
    ctxAdmin,
  }) => {
    const libre = (await (await reporte(ctxAdmin, "2026-03-10", NUM_LIBRE)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(libre.data).toHaveLength(1);
    expect(libre.data[0]).toMatchObject({
      employeeId: `reloj:${NUM_LIBRE}`,
      employeeName: NOMBRE_LIBRE,
      numeroEmpleado: NUM_LIBRE,
      vinculado: false,
      workedMinutes: 540,
    });

    expect((await ctxAdmin.delete(`checador/empleados/${NUM}`)).status()).toBe(200);
    const desvinculada = (await (await reporte(ctxAdmin, "2026-03-10", NUM)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(desvinculada.data[0]).toMatchObject({ employeeId: `reloj:${NUM}`, vinculado: false });
    expect((await ctxAdmin.delete(`checador/empleados/${NUM}`)).status()).toBe(404);
  });
});
