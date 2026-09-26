import type { APIRequestContext } from "@playwright/test";
import type { MetodoChecada } from "@prisma/client";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — checadas de los relojes Hikvision (`/checador`). Ver CHECADOR.md.
 *
 * Las checadas solo entran por la sincronización con los relojes, que aquí NO
 * se dispara (la suite no depende de los equipos). Se siembran con Prisma bajo
 * series de dispositivo propias `E2E-CHK-<run>` y se borran al final; las
 * checadas reales que ya estén en la base no se tocan y cada consulta filtra
 * por los números de empleado de esta corrida.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const SERIE = `${E2E_PREFIX}-CHK-${RUN}`;
/** Un segundo reloj: entrada por uno, salida por otro. */
const SERIE_B = `${E2E_PREFIX}-CHK-${RUN}-B`;
/** Un reloj de puerta de oficina: sus checadas no cuentan para entradas/salidas. */
const SERIE_P = `${E2E_PREFIX}-CHK-${RUN}-P`;
const EMP_A = `${E2E_PREFIX}${RUN}A`;
const EMP_B = `${E2E_PREFIX}${RUN}B`;
let serial = 0;

const sembrar = async (
  numeroEmpleado: string,
  metodo: MetodoChecada,
  occurredAt: string,
  nombre = `E2E Checada ${RUN} ${numeroEmpleado}`,
  dispositivoSerie = SERIE
): Promise<void> => {
  await db.checada.create({
    data: {
      dispositivoSerie,
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
  data: Array<{
    numeroEmpleado: string;
    metodo: string;
    occurredAt: string;
    serialNo: number;
    reloj: string | null;
  }>;
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
  await db.checada.deleteMany({ where: { dispositivoSerie: { in: [SERIE, SERIE_B, SERIE_P] } } });
  await db.checadorReloj.deleteMany({ where: { dispositivoSerie: SERIE_P } });
});

test.describe("Checador — checadas del reloj (E2E)", () => {
  test("sin token 401; EMPLEADO/GUARD 403 en consulta, estado, importación, sincronización y relojes", async ({
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
    // Dar de alta/baja relojes y leer su configuración es solo de ADMIN.
    expect((await ctxAnonimo.post("checador/relojes", { data: {} })).status()).toBe(401);
    expect((await ctxEmpleado.post("checador/relojes", { data: { url: "10.0.0.1" } })).status()).toBe(403);
    expect((await ctxEmpleado.delete("checador/relojes/X")).status()).toBe(403);
    expect((await ctxEmpleado.patch("checador/relojes/X", { data: { asistencia: false } })).status()).toBe(403);
    expect((await ctxEmpleado.get("checador/relojes/X/configuracion")).status()).toBe(403);
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

  test("el estado reporta la configuración y los relojes dados de alta", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("checador/status");
    expect(res.status()).toBe(200);
    const status = (await res.json()) as Record<string, unknown>;
    expect(typeof status.configurado).toBe("boolean");
    expect(status).toHaveProperty("enCurso");
    expect(status).toHaveProperty("importacion");
    expect(Array.isArray(status.dispositivos)).toBe(true);
  });
});

/**
 * Relojes: alta, baja y configuración (`/checador/relojes`). Dar de alta de
 * verdad necesita un reloj que conteste, así que aquí se cubren las
 * validaciones y un reloj "dado de alta" sembrado con Prisma, con una dirección
 * que no contesta (nadie escucha en el puerto 9).
 */
test.describe("Checador — relojes (E2E)", () => {
  const SERIE_R = `${E2E_PREFIX}-CHK-${RUN}-R`;
  const URL_R = "http://127.0.0.1:9";
  const NOMBRE_R = `E2E Reloj ${RUN}`;
  const NUM_R = `${E2E_PREFIX}${RUN}R`;

  test.beforeAll(async () => {
    await db.checadorReloj.create({
      data: { dispositivoSerie: SERIE_R, nombre: NOMBRE_R, url: URL_R, modelo: "E2E" },
    });
    await sembrar(NUM_R, "ROSTRO", "2026-03-10T08:00:00Z", undefined, SERIE_R);
  });

  test.afterAll(async () => {
    await db.checada.deleteMany({ where: { dispositivoSerie: SERIE_R } });
    await db.auditLog.deleteMany({ where: { entityType: "ChecadorReloj", entityId: SERIE_R } });
    await db.checadorReloj.deleteMany({ where: { dispositivoSerie: SERIE_R } });
  });

  test("valida la dirección y avisa si el reloj no contesta", async ({ ctxAdmin }) => {
    const ftp = await ctxAdmin.post("checador/relojes", { data: { url: "ftp://192.168.1.10" } });
    expect(ftp.status()).toBe(400);
    expect(await ftp.json()).toMatchObject({ code: "INVALID_URL" });
    expect((await ctxAdmin.post("checador/relojes", { data: { url: "" } })).status()).toBe(400);

    // Misma dirección que un reloj ya dado de alta: se rechaza sin conectarse.
    const repetido = await ctxAdmin.post("checador/relojes", { data: { url: `${URL_R}/doc/index.html` } });
    expect(repetido.status()).toBe(409);
    expect(await repetido.json()).toMatchObject({ code: "CHECADOR_RELOJ_DUPLICADO" });

    const { configurado } = (await (await ctxAdmin.get("checador/status")).json()) as { configurado: boolean };
    test.skip(!configurado, "La API no tiene CHECADOR_USER: no intenta conectarse");
    const sinConexion = await ctxAdmin.post("checador/relojes", { data: { url: "http://127.0.0.1:10" } });
    expect(sinConexion.status()).toBe(502);
    expect(await sinConexion.json()).toMatchObject({ code: "CHECADOR_SIN_CONEXION" });
  });

  test("el reloj dado de alta sale en el estado y nombra sus checadas", async ({ ctxAdmin }) => {
    const status = (await (await ctxAdmin.get("checador/status")).json()) as {
      dispositivos: Array<Record<string, unknown>>;
    };
    expect(status.dispositivos.find((d) => d.dispositivoSerie === SERIE_R)).toMatchObject({
      nombre: NOMBRE_R,
      url: URL_R,
      checadas: 1,
      ultimaChecada: "2026-03-10T08:00:00.000Z",
      pausadoPorCredenciales: false,
    });

    const pagina = await consultar(ctxAdmin, { dispositivoSerie: SERIE_R });
    expect(pagina.total).toBe(1);
    expect(pagina.data[0]).toMatchObject({ numeroEmpleado: NUM_R, reloj: NOMBRE_R });
  });

  test("la configuración se lee del reloj: si no contesta, 502", async ({ ctxAdmin }) => {
    const { configurado } = (await (await ctxAdmin.get("checador/status")).json()) as { configurado: boolean };
    test.skip(!configurado, "La API no tiene CHECADOR_USER: no intenta conectarse");
    const res = await ctxAdmin.get(`checador/relojes/${SERIE_R}/configuracion`);
    expect(res.status()).toBe(502);
    expect(await res.json()).toMatchObject({ code: "CHECADOR_SIN_CONEXION" });
    expect((await ctxAdmin.get("checador/relojes/NO-EXISTE/configuracion")).status()).toBe(404);
  });

  test("se le cambia el nombre y si cuenta para entradas/salidas, sin tocar el reloj", async ({ ctxAdmin }) => {
    expect(
      await (await ctxAdmin.get("checador/status")).json()
    ).toMatchObject({ dispositivos: expect.arrayContaining([expect.objectContaining({ dispositivoSerie: SERIE_R, asistencia: true })]) });

    const cambio = await ctxAdmin.patch(`checador/relojes/${SERIE_R}`, {
      data: { nombre: "E2E Oficina", asistencia: false },
    });
    expect(cambio.status(), await cambio.text()).toBe(200);
    expect(await cambio.json()).toMatchObject({ dispositivoSerie: SERIE_R, nombre: "E2E Oficina", asistencia: false });
    const bitacora = await db.auditLog.findFirst({
      where: { entityType: "ChecadorReloj", entityId: SERIE_R, action: "CHECADOR_RELOJ_EDITAR" },
    });
    expect(bitacora?.metadata).toMatchObject({
      antes: { nombre: NOMBRE_R, asistencia: true },
      despues: { nombre: "E2E Oficina", asistencia: false },
    });

    // Se regresa el nombre para los tests siguientes.
    const deRegreso = await ctxAdmin.patch(`checador/relojes/${SERIE_R}`, { data: { nombre: NOMBRE_R } });
    expect(await deRegreso.json()).toMatchObject({ nombre: NOMBRE_R, asistencia: false });

    expect((await ctxAdmin.patch(`checador/relojes/${SERIE_R}`, { data: {} })).status()).toBe(400);
    expect((await ctxAdmin.patch(`checador/relojes/${SERIE_R}`, { data: { nombre: " " } })).status()).toBe(400);
    expect((await ctxAdmin.patch("checador/relojes/NO-EXISTE", { data: { asistencia: true } })).status()).toBe(404);
  });

  test("dar de baja lo saca del estado; sus checadas conservan el nombre del reloj", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.delete(`checador/relojes/${SERIE_R}`)).status()).toBe(200);

    const status = (await (await ctxAdmin.get("checador/status")).json()) as {
      dispositivos: Array<Record<string, unknown>>;
    };
    expect(status.dispositivos.some((d) => d.dispositivoSerie === SERIE_R)).toBe(false);
    const pagina = await consultar(ctxAdmin, { dispositivoSerie: SERIE_R });
    expect(pagina.data[0]).toMatchObject({ reloj: NOMBRE_R });

    const reloj = await db.checadorReloj.findUniqueOrThrow({ where: { dispositivoSerie: SERIE_R } });
    expect(reloj).toMatchObject({ url: null, nombre: NOMBRE_R });
    const bitacora = await db.auditLog.findFirst({
      where: { entityType: "ChecadorReloj", entityId: SERIE_R, action: "CHECADOR_RELOJ_BAJA" },
    });
    expect(bitacora).not.toBeNull();

    const otraVez = await ctxAdmin.delete(`checador/relojes/${SERIE_R}`);
    expect(otraVez.status()).toBe(404);
    expect(await otraVez.json()).toMatchObject({ code: "CHECADOR_RELOJ_NOT_FOUND" });
  });
});

/**
 * Vínculos reloj ↔ usuario y entradas/salidas del reloj (`/checador/report`).
 *
 * El reloj no dice si una checada es entrada o salida: en cada jornada la
 * primera es la entrada y la última antes del tope (13 h) la salida, sin
 * importar el reloj; las repetidas (< 5 min) se ignoran y `OTRO` no cuenta.
 * La persona se crea aquí con un nombre propio (para la sugerencia por nombre)
 * y se borra al final junto con sus vínculos y su bitácora.
 */
test.describe("Checador — vínculos y entradas/salidas (E2E)", () => {
  const NUM = `${E2E_PREFIX}${RUN}V`;
  const NUM_LIBRE = `${E2E_PREFIX}${RUN}L`;
  const NUM_DOS_RELOJES = `${E2E_PREFIX}${RUN}D`;
  const NUM_PUERTA = `${E2E_PREFIX}${RUN}P`;
  const NUM_VARIAS = `${E2E_PREFIX}${RUN}M`;
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
    // Entra por un reloj (y repite la checada en otro al pasar), sale por otro.
    await sembrar(NUM_DOS_RELOJES, "ROSTRO", "2026-03-10T07:00:00Z", undefined, SERIE);
    await sembrar(NUM_DOS_RELOJES, "ROSTRO", "2026-03-10T07:03:00Z", undefined, SERIE_B);
    await sembrar(NUM_DOS_RELOJES, "HUELLA", "2026-03-10T15:30:00Z", undefined, SERIE_B);
    // Entra y sale por un reloj que cuenta; checa también en uno marcado sin
    // asistencia (a media jornada y después de salir), que no debe contar.
    await db.checadorReloj.create({ data: { dispositivoSerie: SERIE_P, nombre: "E2E Puerta", asistencia: false } });
    await sembrar(NUM_PUERTA, "ROSTRO", "2026-03-10T07:00:00Z", undefined, SERIE);
    await sembrar(NUM_PUERTA, "ROSTRO", "2026-03-10T11:00:00Z", undefined, SERIE_P);
    await sembrar(NUM_PUERTA, "ROSTRO", "2026-03-10T15:00:00Z", undefined, SERIE);
    await sembrar(NUM_PUERTA, "ROSTRO", "2026-03-10T16:30:00Z", undefined, SERIE_P);
    // Checa varias veces en el turno, en dos relojes que cuentan (una puerta
    // de oficina que sí cuenta): la primera es la entrada y la última la salida.
    for (const [hora, serie] of [
      ["08:00", SERIE],
      ["09:15", SERIE_B],
      ["12:40", SERIE_B],
      ["14:05", SERIE_B],
      ["17:10", SERIE],
    ] as const) {
      await sembrar(NUM_VARIAS, "ROSTRO", `2026-03-10T${hora}:00Z`, undefined, serie);
    }
  });

  test.afterAll(async () => {
    await db.checadorEmpleado.deleteMany({
      where: { numeroEmpleado: { in: [NUM, NUM_LIBRE, NUM_DOS_RELOJES, NUM_PUERTA, NUM_VARIAS] } },
    });
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

  test("la entrada por un reloj y la salida por otro son una sola jornada", async ({ ctxAdmin }) => {
    const res = await reporte(ctxAdmin, "2026-03-10", NUM_DOS_RELOJES);
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    // 07:00 (reloj A) + 07:03 (reloj B, la misma checada repetida) + 15:30 (reloj B).
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T07:00:00.000Z", "2026-03-10T15:30:00.000Z", 510, null],
    ]);
  });

  test("varias checadas en el turno: la primera es la entrada y la última la salida", async ({ ctxAdmin }) => {
    const res = await reporte(ctxAdmin, "2026-03-10", NUM_VARIAS);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T17:10:00.000Z", 550, null],
    ]);
  });

  test("las checadas de un reloj que no cuenta para entradas/salidas no se usan", async ({ ctxAdmin }) => {
    const res = await reporte(ctxAdmin, "2026-03-10", NUM_PUERTA);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    // Si contara, la salida sería la de las 16:30.
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T07:00:00.000Z", "2026-03-10T15:00:00.000Z", 480, null],
    ]);
    // En la tabla de checadas sí están las cuatro.
    expect((await consultar(ctxAdmin, { numeroEmpleado: NUM_PUERTA })).total).toBe(4);
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
