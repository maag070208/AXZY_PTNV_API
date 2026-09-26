import type { APIRequestContext } from "@playwright/test";
import type { PunchMethod } from "@prisma/client";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — checadas de los relojes Hikvision (`/checador`). Ver CHECADOR.md.
 *
 * Las checadas solo entran por la sincronización con los relojes, que aquí NO
 * se dispara (la suite no depende de los equipos). Se siembran con Prisma bajo
 * series de dispositivo propias `E2E-CHK-<run>` y se borran al final; las
 * checadas reales que ya estén en la base no se tocan y cada consulta filtra
 * por los números de empleado de esta corrida.
 */
assertSafeDatabase();

const RUN = newRunId();
const SERIAL = `${E2E_PREFIX}-CHK-${RUN}`;
/** Un segundo reloj: entrada por uno, salida por otro. */
const SERIAL_B = `${E2E_PREFIX}-CHK-${RUN}-B`;
/** Un reloj de puerta de oficina: sus checadas no cuentan para entradas/salidas. */
const SERIAL_P = `${E2E_PREFIX}-CHK-${RUN}-P`;
const EMP_A = `${E2E_PREFIX}${RUN}A`;
const EMP_B = `${E2E_PREFIX}${RUN}B`;
let serial = 0;

const seed = async (
  employeeNumber: string,
  method: PunchMethod,
  occurredAt: string,
  name = `E2E Checada ${RUN} ${employeeNumber}`,
  clockSerial = SERIAL
): Promise<void> => {
  await db.timeClockPunch.create({
    data: {
      clockSerial,
      serialNo: ++serial,
      employeeNumber,
      name,
      method,
      minor: method === "FINGERPRINT" ? 38 : 75,
      occurredAt: new Date(occurredAt),
    },
  });
};

interface Page {
  total: number;
  data: Array<{
    employeeNumber: string;
    method: string;
    occurredAt: string;
    serialNo: number;
    clock: string | null;
  }>;
}

const query = async (
  ctx: APIRequestContext,
  filters: Record<string, string>
): Promise<Page> => {
  const res = await ctx.post("time-clock/query", { data: { page: 1, limit: 50, filters } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Page;
};

test.beforeAll(async () => {
  // A: rostro el 10 y el 12 de marzo, y una checada a las 22:00 del 10 en
  // Tijuana que en UTC ya es el 11. B: huella el 11.
  await seed(EMP_A, "FACE", "2026-03-10T08:00:00Z");
  await seed(EMP_A, "FACE", "2026-03-11T05:00:00Z");
  await seed(EMP_B, "FINGERPRINT", "2026-03-11T15:00:00Z");
  await seed(EMP_A, "FACE", "2026-03-12T23:30:00Z");
});

test.afterAll(async () => {
  await db.timeClockPunch.deleteMany({ where: { clockSerial: { in: [SERIAL, SERIAL_B, SERIAL_P] } } });
  await db.timeClock.deleteMany({ where: { serialNumber: SERIAL_P } });
});

test.describe("Checador — checadas del reloj (E2E)", () => {
  test("sin token 401; EMPLEADO/GUARD 403 en consulta, estado, importación, sincronización y relojes", async ({
    ctxAnonymous,
    ctxEmployee,
    ctxGuard,
  }) => {
    expect((await ctxAnonymous.post("time-clock/query", { data: {} })).status()).toBe(401);
    expect((await ctxEmployee.post("time-clock/query", { data: {} })).status()).toBe(403);
    expect((await ctxEmployee.get("time-clock/status")).status()).toBe(403);
    expect((await ctxEmployee.post("time-clock/import", { data: {} })).status()).toBe(403);
    // El drenado solo lo arranca quien consulta el reloj (solo LEE del equipo).
    expect((await ctxAnonymous.post("time-clock/sync")).status()).toBe(401);
    expect((await ctxEmployee.post("time-clock/sync")).status()).toBe(403);
    expect((await ctxGuard.post("time-clock/sync")).status()).toBe(403);
    // Dar de alta/baja relojes y leer su configuración es solo de ADMIN.
    expect((await ctxAnonymous.post("time-clock/clocks", { data: {} })).status()).toBe(401);
    expect((await ctxEmployee.post("time-clock/clocks", { data: { url: "10.0.0.1" } })).status()).toBe(403);
    expect((await ctxEmployee.delete("time-clock/clocks/X")).status()).toBe(403);
    expect((await ctxEmployee.patch("time-clock/clocks/X", { data: { countsAttendance: false } })).status()).toBe(403);
    expect((await ctxEmployee.get("time-clock/clocks/X/settings")).status()).toBe(403);
  });

  // Solo casos inválidos: uno válido arrancaría una importación real contra el reloj.
  test("la importación valida el rango antes de tocar el reloj", async ({ ctxAdmin }) => {
    const reversed = await ctxAdmin.post("time-clock/import", {
      data: { from: "2026-03-12", to: "2026-03-10" },
    });
    expect(reversed.status()).toBe(400);
    expect(await reversed.json()).toMatchObject({ code: "INVALID_RANGE" });

    const withoutFormat = await ctxAdmin.post("time-clock/import", {
      data: { from: "10/03/2026", to: "2026-03-12" },
    });
    expect(withoutFormat.status()).toBe(400);

    const invalidZone = await ctxAdmin.post("time-clock/import", {
      data: { from: "2026-03-10", to: "2026-03-12", tz: "Marte/Olympus" },
    });
    expect(invalidZone.status()).toBe(400);
    expect(await invalidZone.json()).toMatchObject({ code: "INVALID_TIMEZONE" });
  });

  test("la tabla devuelve las checadas más recientes primero", async ({ ctxAdmin }) => {
    const page = await query(ctxAdmin, { q: `E2E Checada ${RUN}` });
    expect(page.total).toBe(4);
    expect(page.data.map((c) => c.occurredAt)).toEqual([
      "2026-03-12T23:30:00.000Z",
      "2026-03-11T15:00:00.000Z",
      "2026-03-11T05:00:00.000Z",
      "2026-03-10T08:00:00.000Z",
    ]);
  });

  test("filtra por número de empleado exacto y por método", async ({ ctxAdmin }) => {
    const deA = await query(ctxAdmin, { employeeNumber: EMP_A });
    expect(deA.total).toBe(3);
    expect(deA.data.every((c) => c.employeeNumber === EMP_A)).toBe(true);

    const fingerprints = await query(ctxAdmin, { q: `E2E Checada ${RUN}`, method: "FINGERPRINT" });
    expect(fingerprints.total).toBe(1);
    expect(fingerprints.data[0]).toMatchObject({ employeeNumber: EMP_B, method: "FINGERPRINT" });
  });

  test("desde/hasta son días locales de la zona indicada, con `hasta` inclusive", async ({ ctxAdmin }) => {
    const base = { q: `E2E Checada ${RUN}` };

    const utc = await query(ctxAdmin, { ...base, from: "2026-03-10", to: "2026-03-10", tz: "UTC" });
    expect(utc.data.map((c) => c.occurredAt)).toEqual(["2026-03-10T08:00:00.000Z"]);

    // 2026-03-11T05:00Z son las 22:00 del día 10 en Tijuana (UTC-7).
    const tijuana = await query(ctxAdmin, {
      ...base,
      from: "2026-03-10",
      to: "2026-03-10",
      tz: "America/Tijuana",
    });
    expect(tijuana.data.map((c) => c.occurredAt)).toEqual([
      "2026-03-11T05:00:00.000Z",
      "2026-03-10T08:00:00.000Z",
    ]);

    const range = await query(ctxAdmin, { ...base, from: "2026-03-10", to: "2026-03-11", tz: "UTC" });
    expect(range.total).toBe(3);
  });

  test("un método desconocido es 400", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("time-clock/query", { data: { filters: { method: "IRIS" } } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_METHOD" });
  });

  test("el estado reporta la configuración y los relojes dados de alta", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("time-clock/status");
    expect(res.status()).toBe(200);
    const status = (await res.json()) as Record<string, unknown>;
    expect(typeof status.configured).toBe("boolean");
    expect(status).toHaveProperty("inProgress");
    expect(status).toHaveProperty("importJob");
    expect(Array.isArray(status.devices)).toBe(true);
  });
});

/**
 * Relojes: alta, baja y configuración (`/checador/relojes`). Dar de alta de
 * verdad necesita un reloj que conteste, así que aquí se cubren las
 * validaciones y un reloj "dado de alta" sembrado con Prisma, con una dirección
 * que no contesta (nadie escucha en el puerto 9).
 */
test.describe("Checador — relojes (E2E)", () => {
  const SERIAL_R = `${E2E_PREFIX}-CHK-${RUN}-R`;
  const URL_R = "http://127.0.0.1:9";
  const NAME_R = `E2E Reloj ${RUN}`;
  const NUM_R = `${E2E_PREFIX}${RUN}R`;

  test.beforeAll(async () => {
    await db.timeClock.create({
      data: { serialNumber: SERIAL_R, name: NAME_R, url: URL_R, model: "E2E" },
    });
    await seed(NUM_R, "FACE", "2026-03-10T08:00:00Z", undefined, SERIAL_R);
  });

  test.afterAll(async () => {
    await db.timeClockPunch.deleteMany({ where: { clockSerial: SERIAL_R } });
    await db.auditLog.deleteMany({ where: { entityType: "TimeClock", entityId: SERIAL_R } });
    await db.timeClock.deleteMany({ where: { serialNumber: SERIAL_R } });
  });

  test("valida la dirección y avisa si el reloj no contesta", async ({ ctxAdmin }) => {
    const ftp = await ctxAdmin.post("time-clock/clocks", { data: { url: "ftp://192.168.1.10" } });
    expect(ftp.status()).toBe(400);
    expect(await ftp.json()).toMatchObject({ code: "INVALID_URL" });
    expect((await ctxAdmin.post("time-clock/clocks", { data: { url: "" } })).status()).toBe(400);

    // Misma dirección que un reloj ya dado de alta: se rechaza sin conectarse.
    const repeated = await ctxAdmin.post("time-clock/clocks", { data: { url: `${URL_R}/doc/index.html` } });
    expect(repeated.status()).toBe(409);
    expect(await repeated.json()).toMatchObject({ code: "TIME_CLOCK_DUPLICATE" });

    const { configured } = (await (await ctxAdmin.get("time-clock/status")).json()) as { configured: boolean };
    test.skip(!configured, "La API no tiene CHECADOR_USER: no intenta conectarse");
    const withoutConnection = await ctxAdmin.post("time-clock/clocks", { data: { url: "http://127.0.0.1:10" } });
    expect(withoutConnection.status()).toBe(502);
    expect(await withoutConnection.json()).toMatchObject({ code: "TIME_CLOCK_UNREACHABLE" });
  });

  test("el reloj dado de alta sale en el estado y nombra sus checadas", async ({ ctxAdmin }) => {
    const status = (await (await ctxAdmin.get("time-clock/status")).json()) as {
      devices: Array<Record<string, unknown>>;
    };
    expect(status.devices.find((d) => d.clockSerial === SERIAL_R)).toMatchObject({
      name: NAME_R,
      url: URL_R,
      punches: 1,
      lastPunch: "2026-03-10T08:00:00.000Z",
      pausedByCredentials: false,
    });

    const page = await query(ctxAdmin, { clockSerial: SERIAL_R });
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({ employeeNumber: NUM_R, clock: NAME_R });
  });

  test("la configuración se lee del reloj: si no contesta, 502", async ({ ctxAdmin }) => {
    const { configured } = (await (await ctxAdmin.get("time-clock/status")).json()) as { configured: boolean };
    test.skip(!configured, "La API no tiene CHECADOR_USER: no intenta conectarse");
    const res = await ctxAdmin.get(`time-clock/clocks/${SERIAL_R}/settings`);
    expect(res.status()).toBe(502);
    expect(await res.json()).toMatchObject({ code: "TIME_CLOCK_UNREACHABLE" });
    expect((await ctxAdmin.get("time-clock/clocks/NO-EXISTE/settings")).status()).toBe(404);
  });

  test("se le cambia el nombre y si cuenta para entradas/salidas, sin tocar el reloj", async ({ ctxAdmin }) => {
    expect(
      await (await ctxAdmin.get("time-clock/status")).json()
    ).toMatchObject({ devices: expect.arrayContaining([expect.objectContaining({ clockSerial: SERIAL_R, countsAttendance: true })]) });

    const change = await ctxAdmin.patch(`time-clock/clocks/${SERIAL_R}`, {
      data: { name: "E2E Oficina", countsAttendance: false },
    });
    expect(change.status(), await change.text()).toBe(200);
    expect(await change.json()).toMatchObject({ clockSerial: SERIAL_R, name: "E2E Oficina", countsAttendance: false });
    const log = await db.auditLog.findFirst({
      where: { entityType: "TimeClock", entityId: SERIAL_R, action: "TIME_CLOCK_UPDATED" },
    });
    expect(log?.metadata).toMatchObject({
      before: { name: NAME_R, countsAttendance: true },
      after: { name: "E2E Oficina", countsAttendance: false },
    });

    // Se regresa el nombre para los tests siguientes.
    const fromReturn = await ctxAdmin.patch(`time-clock/clocks/${SERIAL_R}`, { data: { name: NAME_R } });
    expect(await fromReturn.json()).toMatchObject({ name: NAME_R, countsAttendance: false });

    expect((await ctxAdmin.patch(`time-clock/clocks/${SERIAL_R}`, { data: {} })).status()).toBe(400);
    expect((await ctxAdmin.patch(`time-clock/clocks/${SERIAL_R}`, { data: { name: " " } })).status()).toBe(400);
    expect((await ctxAdmin.patch("time-clock/clocks/NO-EXISTE", { data: { countsAttendance: true } })).status()).toBe(404);
  });

  test("dar de baja lo saca del estado; sus checadas conservan el nombre del reloj", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.delete(`time-clock/clocks/${SERIAL_R}`)).status()).toBe(200);

    const status = (await (await ctxAdmin.get("time-clock/status")).json()) as {
      devices: Array<Record<string, unknown>>;
    };
    expect(status.devices.some((d) => d.clockSerial === SERIAL_R)).toBe(false);
    const page = await query(ctxAdmin, { clockSerial: SERIAL_R });
    expect(page.data[0]).toMatchObject({ clock: NAME_R });

    const clock = await db.timeClock.findUniqueOrThrow({ where: { serialNumber: SERIAL_R } });
    expect(clock).toMatchObject({ url: null, name: NAME_R });
    const log = await db.auditLog.findFirst({
      where: { entityType: "TimeClock", entityId: SERIAL_R, action: "TIME_CLOCK_RETIRED" },
    });
    expect(log).not.toBeNull();

    const again = await ctxAdmin.delete(`time-clock/clocks/${SERIAL_R}`);
    expect(again.status()).toBe(404);
    expect(await again.json()).toMatchObject({ code: "TIME_CLOCK_NOT_FOUND" });
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
  const FREE_NUM = `${E2E_PREFIX}${RUN}L`;
  const NUM_TWO_CLOCKS = `${E2E_PREFIX}${RUN}D`;
  const NUM_DOOR = `${E2E_PREFIX}${RUN}P`;
  const NUM_SEVERAL = `${E2E_PREFIX}${RUN}M`;
  const SYSTEM_NAME = "Ximena Yolotl Zuazua Checador";
  const CLOCK_NAME = "ZUAZUA CHECADOR XIMENA YOLOTL";
  const FREE_NAME = `E2E Reloj Libre ${RUN}`;
  const report = (ctx: APIRequestContext, date: string, q: string) =>
    ctx.post("time-clock/report", {
      data: { page: 1, limit: 50, filters: { period: "DAY", date, tz: "UTC", q }, sort: { key: "entryAt", direction: "asc" } },
    });
  let person: { id: string; name: string };

  test.beforeAll(async () => {
    await db.user.deleteMany({ where: { username: { startsWith: "e2e_checador_" } } });
    person = await db.user.create({
      data: {
        username: `e2e_checador_${RUN}`.toLowerCase(),
        name: SYSTEM_NAME,
        role: "EMPLOYEE",
        password: "!sin-login",
      },
      select: { id: true, name: true },
    });

    // Día 1: 08:00 + repetida 08:02 + 17:00 → una jornada de 9 h; la de `OTRO`
    // (12:00) no cuenta. Turno nocturno 22:00 → 06:00 del día 2 (se atribuye al
    // día 1). Día 2: 12:00 suelta → entrada sin salida.
    await seed(NUM, "FACE", "2026-03-10T08:00:00Z", CLOCK_NAME);
    await seed(NUM, "FACE", "2026-03-10T08:02:00Z", CLOCK_NAME);
    await seed(NUM, "OTHER", "2026-03-10T12:00:00Z", CLOCK_NAME);
    await seed(NUM, "FINGERPRINT", "2026-03-10T17:00:00Z", CLOCK_NAME);
    await seed(NUM, "FACE", "2026-03-10T22:00:00Z", CLOCK_NAME);
    await seed(NUM, "FACE", "2026-03-11T06:00:00Z", CLOCK_NAME);
    await seed(NUM, "FACE", "2026-03-11T12:00:00Z", CLOCK_NAME);
    await seed(FREE_NUM, "FINGERPRINT", "2026-03-10T09:00:00Z", FREE_NAME);
    await seed(FREE_NUM, "FINGERPRINT", "2026-03-10T18:00:00Z", FREE_NAME);
    // Entra por un reloj (y repite la checada en otro al pasar), sale por otro.
    await seed(NUM_TWO_CLOCKS, "FACE", "2026-03-10T07:00:00Z", undefined, SERIAL);
    await seed(NUM_TWO_CLOCKS, "FACE", "2026-03-10T07:03:00Z", undefined, SERIAL_B);
    await seed(NUM_TWO_CLOCKS, "FINGERPRINT", "2026-03-10T15:30:00Z", undefined, SERIAL_B);
    // Entra y sale por un reloj que cuenta; checa también en uno marcado sin
    // asistencia (a media jornada y después de salir), que no debe contar.
    await db.timeClock.create({ data: { serialNumber: SERIAL_P, name: "E2E Puerta", countsAttendance: false } });
    await seed(NUM_DOOR, "FACE", "2026-03-10T07:00:00Z", undefined, SERIAL);
    await seed(NUM_DOOR, "FACE", "2026-03-10T11:00:00Z", undefined, SERIAL_P);
    await seed(NUM_DOOR, "FACE", "2026-03-10T15:00:00Z", undefined, SERIAL);
    await seed(NUM_DOOR, "FACE", "2026-03-10T16:30:00Z", undefined, SERIAL_P);
    // Checa varias veces en el turno, en dos relojes que cuentan (una puerta
    // de oficina que sí cuenta): la primera es la entrada y la última la salida.
    for (const [hour, serial] of [
      ["08:00", SERIAL],
      ["09:15", SERIAL_B],
      ["12:40", SERIAL_B],
      ["14:05", SERIAL_B],
      ["17:10", SERIAL],
    ] as const) {
      await seed(NUM_SEVERAL, "FACE", `2026-03-10T${hour}:00Z`, undefined, serial);
    }
  });

  test.afterAll(async () => {
    await db.timeClockEmployee.deleteMany({
      where: { employeeNumber: { in: [NUM, FREE_NUM, NUM_TWO_CLOCKS, NUM_DOOR, NUM_SEVERAL] } },
    });
    await db.auditLog.deleteMany({
      where: { entityType: "TimeClockEmployee", entityId: { in: [NUM, FREE_NUM] } },
    });
    await db.user.deleteMany({ where: { id: person.id } });
  });

  test("sugiere a la persona por nombre (en otro orden) y solo ADMIN/RH vinculan", async ({
    ctxAdmin,
    ctxEmployee,
  }) => {
    const res = await ctxAdmin.post("time-clock/employees/query", { data: { filters: { q: NUM } } });
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(data).toHaveLength(1);
    // El número del reloj no es numérico → solo coincide el nombre: MEDIA.
    expect(data[0]).toMatchObject({
      employeeNumber: NUM,
      name: CLOCK_NAME,
      punches: 7,
      link: null,
      suggestion: { userId: person.id, confidence: "MEDIUM" },
    });

    const withoutPermission = await ctxEmployee.put(`time-clock/employees/${NUM}`, { data: { userId: person.id } });
    expect(withoutPermission.status()).toBe(403);
    const nonexistent = await ctxAdmin.put(`time-clock/employees/${NUM}`, { data: { userId: "no-existe" } });
    expect(nonexistent.status()).toBe(404);
  });

  test("vinculada, sus checadas se emparejan en jornadas del día de la entrada", async ({ ctxAdmin }) => {
    const link = await ctxAdmin.put(`time-clock/employees/${NUM}`, { data: { userId: person.id } });
    expect(link.status()).toBe(200);
    expect(await link.json()).toMatchObject({ link: { userId: person.id } });

    const day1 = (await (await report(ctxAdmin, "2026-03-10", SYSTEM_NAME)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(day1.data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T17:00:00.000Z", 540, null],
      ["2026-03-10T22:00:00.000Z", "2026-03-11T06:00:00.000Z", 480, null],
    ]);
    expect(day1.data[0]).toMatchObject({ employeeId: person.id, employeeName: SYSTEM_NAME, linked: true });
    expect(day1.data[1]).toMatchObject({ crossesMidnight: true });

    const day2 = (await (await report(ctxAdmin, "2026-03-11", SYSTEM_NAME)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(day2.data).toHaveLength(1);
    expect(day2.data[0]).toMatchObject({
      entryAt: "2026-03-11T12:00:00.000Z",
      exitAt: null,
      incident: "ENTRY_WITHOUT_EXIT",
    });
  });

  test("la entrada por un reloj y la salida por otro son una sola jornada", async ({ ctxAdmin }) => {
    const res = await report(ctxAdmin, "2026-03-10", NUM_TWO_CLOCKS);
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    // 07:00 (reloj A) + 07:03 (reloj B, la misma checada repetida) + 15:30 (reloj B).
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T07:00:00.000Z", "2026-03-10T15:30:00.000Z", 510, null],
    ]);
  });

  test("varias checadas en el turno: la primera es la entrada y la última la salida", async ({ ctxAdmin }) => {
    const res = await report(ctxAdmin, "2026-03-10", NUM_SEVERAL);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T17:10:00.000Z", 550, null],
    ]);
  });

  test("las checadas de un reloj que no cuenta para entradas/salidas no se usan", async ({ ctxAdmin }) => {
    const res = await report(ctxAdmin, "2026-03-10", NUM_DOOR);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    // Si contara, la salida sería la de las 16:30.
    expect(data.map((r) => [r.entryAt, r.exitAt, r.workedMinutes, r.incident])).toEqual([
      ["2026-03-10T07:00:00.000Z", "2026-03-10T15:00:00.000Z", 480, null],
    ]);
    // En la tabla de checadas sí están las cuatro.
    expect((await query(ctxAdmin, { employeeNumber: NUM_DOOR })).total).toBe(4);
  });

  test("quien checa sin vincular sale con el nombre del reloj; al desvincular, igual", async ({
    ctxAdmin,
  }) => {
    const free = (await (await report(ctxAdmin, "2026-03-10", FREE_NUM)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(free.data).toHaveLength(1);
    expect(free.data[0]).toMatchObject({
      employeeId: `reloj:${FREE_NUM}`,
      employeeName: FREE_NAME,
      employeeNumber: FREE_NUM,
      linked: false,
      workedMinutes: 540,
    });

    expect((await ctxAdmin.delete(`time-clock/employees/${NUM}`)).status()).toBe(200);
    const unlinked = (await (await report(ctxAdmin, "2026-03-10", NUM)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(unlinked.data[0]).toMatchObject({ employeeId: `reloj:${NUM}`, linked: false });
    expect((await ctxAdmin.delete(`time-clock/employees/${NUM}`)).status()).toBe(404);
  });
});
