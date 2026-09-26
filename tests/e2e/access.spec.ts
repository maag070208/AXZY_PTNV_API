import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — módulo de control de acceso (`/access`).
 *
 * Cubre: alta de evento (éxito/GPS/SITE_ONLY), idempotencia, anti-duplicado,
 * consistencia de secuencia, empleado de baja, QR inválido, permisos por rol,
 * anulación lógica y tabla server-side. Ver ENTRADAS_SALIDAS.md §4 y §10.
 *
 * Igual que el resto de la suite: contra la API real, aislamiento por prefijo
 * `E2E` y limpieza en `afterEach`. Los empleados de prueba se crean con
 * `POST /users` y se borran junto con sus eventos y audit_logs.
 */
assertSafeDatabase();

const RUN = newRunId();
const employeesCreated: string[] = [];
const sitesCreated: string[] = [];
let sequence = 0;

const clientEventId = (): string =>
  `${E2E_PREFIX}-${RUN}-${String(++sequence).padStart(4, "0")}`;

const qrDe = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: 2, id, ...extra });

const idDe = async (username: string): Promise<string> => {
  const user = await db.user.findUnique({ where: { username } });
  if (!user) throw new Error(`${username} no está provisionado (¿corrió globalSetup?)`);
  return user.id;
};

const createEmployee = async (
  ctxAdmin: APIRequestContext,
  suffix: string
): Promise<{ id: string; name: string }> => {
  const name = `E2E Access ${RUN} ${suffix}`;
  const res = await ctxAdmin.post("users", {
    data: {
      username: `e2e_access_${RUN}_${suffix}`.toLowerCase(),
      password: "E2E-Access-2026!",
      name,
      role: "EMPLOYEE",
    },
  });
  if (res.status() !== 201) {
    throw new Error(`No se pudo crear el empleado (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  employeesCreated.push(body.id);
  return { id: body.id, name };
};

test.afterEach(async () => {
  const employees = employeesCreated.splice(0);
  const sites = sitesCreated.splice(0);

  const events = await db.accessEvent.findMany({
    where: {
      OR: [
        { clientEventId: { startsWith: `${E2E_PREFIX}-${RUN}` } },
        ...(employees.length ? [{ employeeId: { in: employees } }] : []),
      ],
    },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  if (eventIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "AccessEvent", entityId: { in: eventIds } },
    });
    await db.accessEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  if (sites.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Site", entityId: { in: sites } } });
    await db.site.deleteMany({ where: { id: { in: sites } } });
  }

  if (employees.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "User", entityId: { in: employees } } });
    await db.user.deleteMany({ where: { id: { in: employees } } });
  }
});

test.describe("Access — control de acceso (E2E)", () => {
  test("lookup resuelve la credencial y registra un ENTRY con todos los campos", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const guardId = await idDe(E2E.guard.username);
    const emp = await createEmployee(ctxAdmin, "ok");
    const qr = qrDe(emp.id, { name: emp.name, no: "E2E-001", pos: "Analista", dept: "Sistemas" });

    const look = await ctxGuard.post("access/lookup", { data: { qr } });
    expect(look.status()).toBe(200);
    const profile = (await look.json()) as Record<string, unknown>;
    expect(profile).toMatchObject({
      id: emp.id,
      name: emp.name,
      active: true,
      credentialVersion: 2,
      lastEvent: null,
      suggestedType: "ENTRY",
    });

    const cid = clientEventId();
    const res = await ctxGuard.post("access/events", {
      data: {
        qr,
        type: "ENTRY",
        siteId: siteDemoId,
        clientEventId: cid,
        deviceTimestamp: new Date().toISOString(),
        deviceId: "dev-1",
        deviceCode: "guard-phone",
        notes: "turno matutino",
      },
    });
    expect(res.status()).toBe(201);
    const ev = (await res.json()) as Record<string, unknown>;
    expect(ev).toMatchObject({
      type: "ENTRY",
      employeeId: emp.id,
      employeeNameSnapshot: emp.name,
      siteId: siteDemoId,
      locationSource: "SITE_ONLY",
      method: "QR_SCAN",
      credentialVersion: 2,
      clientEventId: cid,
      deviceId: "dev-1",
      deviceCode: "guard-phone",
      notes: "turno matutino",
      latitude: null,
      longitude: null,
      voidedAt: null,
      guardId,
    });
    expect(ev.occurredAt).toEqual(expect.any(String));
    expect(ev.scannedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect((ev.site as { name: string }).name).toBe(E2E.demoSite.name);

    const audit = await db.auditLog.findFirst({
      where: { entityType: "AccessEvent", entityId: String(ev.id), action: "ACCESS_EVENT_CREATED" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(guardId);
    expect(audit?.metadata).toMatchObject({ siteId: siteDemoId });
  });

  test("lookup: fotoUrl es una ruta relativa a la base de la API (sin /api/v1)", async ({
    ctxAdmin,
    ctxGuard,
  }) => {
    // El contrato: `fotoUrl` es relativa a la base de la API y el cliente la
    // resuelve contra ella. Nunca incluye host ni el prefijo `/api/v1`.
    const emp = await createEmployee(ctxAdmin, "photo");
    await db.user.update({ where: { id: emp.id }, data: { photoKey: `e2e/${emp.id}.jpg` } });

    const look = await ctxGuard.post("access/lookup", { data: { qr: qrDe(emp.id) } });
    expect(look.status()).toBe(200);
    const profile = (await look.json()) as { photoUrl: string | null };
    expect(profile.photoUrl).toBe(`/hr/${emp.id}/photo/raw`);
    expect(profile.photoUrl?.startsWith("/hr/")).toBe(true);
    expect(profile.photoUrl).not.toContain("/api/v1");
    expect(profile.photoUrl).not.toMatch(/^https?:\/\//);
  });

  test("lookup: fotoUrl es null cuando el empleado no tiene foto", async ({
    ctxAdmin,
    ctxGuard,
  }) => {
    const emp = await createEmployee(ctxAdmin, "sinfoto");
    const look = await ctxGuard.post("access/lookup", { data: { qr: qrDe(emp.id) } });
    expect(look.status()).toBe(200);
    expect(((await look.json()) as { photoUrl: string | null }).photoUrl).toBeNull();
  });

  test("con GPS usa locationSource GPS y guarda coordenadas y precisión", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const emp = await createEmployee(ctxAdmin, "gps");
    const res = await ctxGuard.post("access/events", {
      data: {
        qr: qrDe(emp.id),
        type: "ENTRY",
        siteId: siteDemoId,
        clientEventId: clientEventId(),
        latitude: 19.4326,
        longitude: -99.1332,
        accuracy: 8.5,
      },
    });
    expect(res.status()).toBe(201);
    const ev = (await res.json()) as Record<string, unknown>;
    expect(ev.locationSource).toBe("GPS");
    expect(ev.latitude as number).toBeCloseTo(19.4326);
    expect(ev.longitude as number).toBeCloseTo(-99.1332);
    expect(ev.gpsAccuracyMeters as number).toBeCloseTo(8.5);
  });

  test("idempotencia: el mismo clientEventId devuelve 200 y un solo registro", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const emp = await createEmployee(ctxAdmin, "idem");
    const cid = clientEventId();
    const payload = { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: cid };

    const first = await ctxGuard.post("access/events", { data: payload });
    expect(first.status()).toBe(201);
    const ev1 = (await first.json()) as { id: string };

    const second = await ctxGuard.post("access/events", { data: payload });
    expect(second.status()).toBe(200);
    const ev2 = (await second.json()) as { id: string };
    expect(ev2.id).toBe(ev1.id);

    const count = await db.accessEvent.count({ where: { clientEventId: cid } });
    expect(count).toBe(1);
  });

  test("anti-duplicado: mismo empleado y tipo dentro de la ventana → 409 con el evento previo", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const emp = await createEmployee(ctxAdmin, "dup");
    const first = await ctxGuard.post("access/events", {
      data: { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(first.status()).toBe(201);
    const ev1 = (await first.json()) as { id: string };

    const second = await ctxGuard.post("access/events", {
      data: { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(second.status()).toBe(409);
    const body = (await second.json()) as {
      code?: string;
      details?: { previousEvent?: { id: string } };
    };
    expect(body.code).toBe("DUPLICATE_ACCESS_EVENT");
    expect(body.details?.previousEvent?.id).toBe(ev1.id);
  });

  test("secuencia: EXIT sin ENTRY → 409; ENTRY con entrada abierta → 409", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const empExit = await createEmployee(ctxAdmin, "exit");
    const exit = await ctxGuard.post("access/events", {
      data: { qr: qrDe(empExit.id), type: "EXIT", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(exit.status()).toBe(409);
    expect(((await exit.json()) as { code?: string }).code).toBe("ACCESS_EXIT_WITHOUT_ENTRY");

    const empEntry = await createEmployee(ctxAdmin, "open");
    const first = await ctxGuard.post("access/events", {
      data: { qr: qrDe(empEntry.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(first.status()).toBe(201);
    const ev1 = (await first.json()) as { id: string };

    // Sacamos el primer ENTRY de la ventana anti-duplicado para aislar la
    // regla de secuencia de la regla temporal.
    await db.accessEvent.update({
      where: { id: ev1.id },
      data: { occurredAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const second = await ctxGuard.post("access/events", {
      data: { qr: qrDe(empEntry.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(second.status()).toBe(409);
    expect(((await second.json()) as { code?: string }).code).toBe("ACCESS_ENTRY_ALREADY_OPEN");
  });

  test("empleado de baja no puede registrar acceso; el lookup lo marca inactivo", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const emp = await createEmployee(ctxAdmin, "retirement");
    const retirement = await ctxAdmin.patch(`users/${emp.id}/deactivate`, {
      data: { reason: "E2E baja", notifyUser: false },
    });
    expect(retirement.status()).toBe(200);

    const res = await ctxGuard.post("access/events", {
      data: { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("EMPLOYEE_INACTIVE");

    const look = await ctxGuard.post("access/lookup", { data: { qr: qrDe(emp.id) } });
    expect(look.status()).toBe(200);
    expect(((await look.json()) as { active: boolean }).active).toBe(false);
  });

  test("QR inválido: texto plano y JSON roto → 400; id inexistente → 404", async ({
    ctxGuard,
    siteDemoId,
  }) => {
    const base = { type: "ENTRY", siteId: siteDemoId };

    const flat = await ctxGuard.post("access/events", {
      data: { ...base, qr: "no-es-un-qr", clientEventId: clientEventId() },
    });
    expect(flat.status()).toBe(400);

    const broken = await ctxGuard.post("access/events", {
      data: { ...base, qr: '{"v":2,"id":', clientEventId: clientEventId() },
    });
    expect(broken.status()).toBe(400);

    const nonexistent = "00000000-0000-4000-8000-000000000000";
    const withoutEmployee = await ctxGuard.post("access/events", {
      data: { ...base, qr: qrDe(nonexistent), clientEventId: clientEventId() },
    });
    expect(withoutEmployee.status()).toBe(404);

    const look = await ctxGuard.post("access/lookup", { data: { qr: qrDe(nonexistent) } });
    expect(look.status()).toBe(404);
  });

  test("permisos: 401 sin token; EMPLEADO 403 en /events; GUARD 403 en /query; GUARD 200 en /sites", async ({
    ctxAnonymous,
    ctxEmployee,
    ctxGuard,
    siteDemoId,
  }) => {
    const body = {
      employeeId: "00000000-0000-4000-8000-000000000000",
      type: "ENTRY",
      siteId: siteDemoId,
      clientEventId: clientEventId(),
    };

    const anon = await ctxAnonymous.post("access/events", { data: body });
    expect(anon.status()).toBe(401);

    const employee = await ctxEmployee.post("access/events", { data: body });
    expect(employee.status()).toBe(403);

    const guardQuery = await ctxGuard.post("access/query", { data: { page: 1, limit: 10 } });
    expect(guardQuery.status()).toBe(403);

    const guardSites = await ctxGuard.get("access/sites");
    expect(guardSites.status()).toBe(200);
    expect(Array.isArray(await guardSites.json())).toBe(true);

    const guardToday = await ctxGuard.get("access/me/today");
    expect(guardToday.status()).toBe(200);

    const employeeToday = await ctxEmployee.get("access/me/today");
    expect(employeeToday.status()).toBe(403);
  });

  test("anulación: GUARD 403; ADMIN 200 y doble void idempotente con auditoría", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const adminId = await idDe(E2E.admin.username);
    const emp = await createEmployee(ctxAdmin, "void");
    const created = await ctxGuard.post("access/events", {
      data: { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
    });
    expect(created.status()).toBe(201);
    const ev = (await created.json()) as { id: string };

    const guardVoid = await ctxGuard.post(`access/${ev.id}/void`, { data: { reason: "sin permiso" } });
    expect(guardVoid.status()).toBe(403);

    const adminVoid = await ctxAdmin.post(`access/${ev.id}/void`, { data: { reason: "Escaneo duplicado" } });
    expect(adminVoid.status()).toBe(200);
    const voided = (await adminVoid.json()) as {
      voidedAt: string | null;
      voidedById: string | null;
      voidReason: string | null;
    };
    expect(voided.voidedAt).toEqual(expect.any(String));
    expect(voided.voidReason).toBe("Escaneo duplicado");
    expect(voided.voidedById).toBe(adminId);

    const again = await ctxAdmin.post(`access/${ev.id}/void`, { data: { reason: "otra vez" } });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { voidedAt: string | null }).voidedAt).toBe(voided.voidedAt);

    const audit = await db.auditLog.findFirst({
      where: { entityType: "AccessEvent", entityId: ev.id, action: "ACCESS_EVENT_VOIDED" },
    });
    expect(audit).not.toBeNull();
    // La auditoría debe atribuir la anulación al actor que la ejecuta (el
    // ADMIN), no al guardia que creó el evento.
    expect(audit?.userId).toBe(adminId);
    expect(audit?.userName).toBe(E2E.admin.username);
    expect(audit?.userName).not.toBe(E2E.guard.username);
  });

  test("tabla: filtros, orden, paginación y limit acotado a 100", async ({
    ctxAdmin,
    ctxGuard,
    siteDemoId,
  }) => {
    const empA = await createEmployee(ctxAdmin, "taba");
    const empB = await createEmployee(ctxAdmin, "tabb");
    for (const emp of [empA, empB]) {
      const res = await ctxGuard.post("access/events", {
        data: { qr: qrDe(emp.id), type: "ENTRY", siteId: siteDemoId, clientEventId: clientEventId() },
      });
      expect(res.status()).toBe(201);
    }

    const filtered = await ctxAdmin.post("access/query", {
      data: {
        page: 1,
        limit: 10,
        filters: { employeeId: empA.id, type: "ENTRY" },
        sort: { key: "occurredAt", direction: "desc" },
      },
    });
    expect(filtered.status()).toBe(200);
    const page = (await filtered.json()) as { total: number; data: Array<{ employeeId: string }> };
    expect(page.total).toBe(1);
    expect(page.data[0].employeeId).toBe(empA.id);

    const capped = await ctxAdmin.post("access/query", { data: { page: 1, limit: 1000 } });
    expect(capped.status()).toBe(200);
    const cappedBody = (await capped.json()) as { limit: number; data: unknown[] };
    expect(cappedBody.limit).toBeLessThanOrEqual(100);
    expect(cappedBody.data.length).toBeLessThanOrEqual(100);

    const paged = await ctxAdmin.post("access/query", {
      data: { page: 2, limit: 1, filters: { q: RUN } },
    });
    expect(paged.status()).toBe(200);
    const pagedBody = (await paged.json()) as { page: number; data: unknown[] };
    expect(pagedBody.page).toBe(2);
    expect(pagedBody.data.length).toBeLessThanOrEqual(1);
  });

  test("sitios: ADMIN crea y edita; GUARD no puede crear", async ({ ctxAdmin, ctxGuard }) => {
    const code = `${E2E_PREFIX}-${RUN}-SITE`;
    const name = `E2E Sitio ${RUN}`;

    const denied = await ctxGuard.post("access/sites", { data: { name, code } });
    expect(denied.status()).toBe(403);

    const created = await ctxAdmin.post("access/sites", {
      data: { name, code, latitude: 19.4, longitude: -99.1, radiusMeters: 100 },
    });
    expect(created.status()).toBe(201);
    const site = (await created.json()) as { id: string; name: string; code: string; active: boolean; radiusMeters: number };
    sitesCreated.push(site.id);
    expect(site).toMatchObject({ name, code, active: true, radiusMeters: 100 });

    const updated = await ctxAdmin.put(`access/sites/${site.id}`, { data: { active: false } });
    expect(updated.status()).toBe(200);
    expect(((await updated.json()) as { active: boolean }).active).toBe(false);
  });

  test("bitácora: el boundary de fecha respeta el tz (evento a las 23:30 local)", async ({
    ctxAdmin,
  }) => {
    const emp = await createEmployee(ctxAdmin, "tz");
    // 23:30 local en America/Mexico_City (UTC-6) del 2026-01-15 = 05:30Z del 16.
    await db.accessEvent.create({
      data: {
        type: "ENTRY",
        occurredAt: new Date("2026-01-16T05:30:00.000Z"),
        employeeId: emp.id,
        method: "MANUAL",
        locationSource: "SITE_ONLY",
        clientEventId: clientEventId(),
      },
    });

    const sameDay = await ctxAdmin.post("access/query", {
      data: {
        page: 1,
        limit: 10,
        filters: {
          employeeId: emp.id,
          start: "2026-01-15",
          end: "2026-01-15",
          tz: "America/Mexico_City",
        },
      },
    });
    expect(sameDay.status()).toBe(200);
    expect(((await sameDay.json()) as { total: number }).total).toBe(1);

    const nextDay = await ctxAdmin.post("access/query", {
      data: {
        page: 1,
        limit: 10,
        filters: {
          employeeId: emp.id,
          start: "2026-01-16",
          end: "2026-01-16",
          tz: "America/Mexico_City",
        },
      },
    });
    expect(nextDay.status()).toBe(200);
    expect(((await nextDay.json()) as { total: number }).total).toBe(0);
  });
});
