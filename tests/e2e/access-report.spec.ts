import type { APIRequestContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import type { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — reporte de entradas/salidas por persona (`POST /access/report`).
 *
 * El `occurredAt` lo fija el servidor, así que los eventos se siembran con
 * Prisma directo (no vía `/access/events`) para poder fecharlos en un periodo
 * fijo. Igual que el resto de la suite: aislamiento por prefijo `E2E` y limpieza
 * en `afterEach`. Ver ENTRADAS_SALIDAS.md §13 (reporte).
 */
assertSafeDatabase();

const RUN = newRunId();
const TZ = "UTC";

const employeesCreated: string[] = [];
const departmentsCreated: string[] = [];
const contextsCreated: APIRequestContext[] = [];
let sequence = 0;

const clientEventId = (): string =>
  `${E2E_PREFIX}-${RUN}-RPT-${String(++sequence).padStart(4, "0")}`;

/** Instante UTC de un día + hora (el reporte usa `tz` explícito). */
const at = (dateKey: string, hour: number, minute = 0): Date =>
  new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const createEmployee = async (opts: {
  suffix: string;
  role?: Role;
  departmentId?: string | null;
  active?: boolean;
}): Promise<{ id: string; name: string }> => {
  const name = `E2E Reporte ${RUN} ${opts.suffix}`;
  const password = await bcrypt.hash(E2E.password, 10);
  const user = await db.user.create({
    data: {
      username: `e2e_report_${RUN}_${opts.suffix}`.toLowerCase(),
      name,
      role: opts.role ?? "EMPLOYEE",
      active: opts.active ?? true,
      departmentId: opts.departmentId ?? null,
      password,
    },
  });
  employeesCreated.push(user.id);
  return { id: user.id, name };
};

const createDepartment = async (suffix: string): Promise<string> => {
  const dept = await db.department.create({
    data: { name: `E2E Depto ${RUN} ${suffix}` },
  });
  departmentsCreated.push(dept.id);
  return dept.id;
};

const seed = async (
  employeeId: string,
  type: "ENTRY" | "EXIT",
  occurredAt: Date
): Promise<string> => {
  const event = await db.accessEvent.create({
    data: {
      type,
      occurredAt,
      employeeId,
      method: "MANUAL",
      locationSource: "SITE_ONLY",
      clientEventId: clientEventId(),
    },
    select: { id: true },
  });
  return event.id;
};

const voidEntry = async (eventId: string, reason = "E2E reporte"): Promise<void> => {
  await db.accessEvent.update({
    where: { id: eventId },
    data: { voidedAt: new Date(), voidReason: reason },
  });
};

interface ReportBody {
  page?: number;
  limit?: number;
  filters: Record<string, string | number | boolean>;
  sort?: { key: string; direction: "asc" | "desc" };
}

const report = async (ctx: APIRequestContext, body: ReportBody) => ctx.post("access/report", { data: body });

const reportExport = async (ctx: APIRequestContext, body: ReportBody) =>
  ctx.post("access/report/export", { data: body });

/** Contexto autenticado para un usuario ya existente (patrón de `fixtures.ts`). */
const contextFor = async (username: string): Promise<APIRequestContext> => {
  const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
  const res = await login.post("auth/login", { data: { username, password: E2E.password } });
  if (res.status() !== 200) {
    throw new Error(`No se pudo autenticar a "${username}" (${res.status()}): ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  await login.dispose();
  const ctx = await playwrightRequest.newContext({
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  contextsCreated.push(ctx);
  return ctx;
};

test.afterEach(async () => {
  const employees = employeesCreated.splice(0);
  const departments = departmentsCreated.splice(0);
  const contexts = contextsCreated.splice(0);
  await Promise.all(contexts.map((ctx) => ctx.dispose()));

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
    await db.auditLog.deleteMany({ where: { entityType: "AccessEvent", entityId: { in: eventIds } } });
    await db.accessEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  if (employees.length > 0) {
    await db.auditLog.deleteMany({ where: { userId: { in: employees } } });
    await db.user.deleteMany({ where: { id: { in: employees } } });
  }
  if (departments.length > 0) {
    await db.department.deleteMany({ where: { id: { in: departments } } });
  }
});

test.describe("Access report — entradas/salidas por persona (E2E)", () => {
  test("un par ENTRY 08:00 / EXIT 17:00 da 540 min sin incidencias", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "par" });
    await seed(emp.id, "ENTRY", at("2026-01-15", 8));
    await seed(emp.id, "EXIT", at("2026-01-15", 17));

    const res = await report(ctxAdmin, {
      page: 1,
      limit: 10,
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      total: number;
      data: Array<Record<string, unknown>>;
      summary: { peopleTotal: number };
    };
    expect(body.total).toBe(1);
    const row = body.data[0];
    expect(row).toMatchObject({
      employeeId: emp.id,
      hasRecords: true,
      workedMinutes: 540,
      sessionCount: 1,
      daysWithRecords: 1,
      incidents: [],
    });
    expect(row.firstEntryAt).toBe(at("2026-01-15", 8).toISOString());
    expect(row.lastExitAt).toBe(at("2026-01-15", 17).toISOString());
  });

  test("dos pares suman (08:00–12:00 y 13:00–17:00) sin inflar horas", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "pares" });
    await seed(emp.id, "ENTRY", at("2026-01-15", 8));
    await seed(emp.id, "EXIT", at("2026-01-15", 12));
    await seed(emp.id, "ENTRY", at("2026-01-15", 13));
    await seed(emp.id, "EXIT", at("2026-01-15", 17));

    const res = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    const row = body.data[0];
    expect(row).toMatchObject({
      sessionCount: 2,
      workedMinutes: 480,
      daysWithRecords: 1,
      incidents: [],
    });
    expect(row.firstEntryAt).toBe(at("2026-01-15", 8).toISOString());
    expect(row.lastExitAt).toBe(at("2026-01-15", 17).toISOString());
  });

  test("entrada huérfana de un periodo en curso → OPEN_ENTRY, 0 min", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "abierta" });
    await seed(emp.id, "ENTRY", new Date());

    const res = await report(ctxAdmin, {
      filters: { period: "DAY", date: todayUtc(), tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    const row = body.data[0];
    expect(row).toMatchObject({ hasRecords: true, workedMinutes: 0, incidents: ["OPEN_ENTRY"] });
  });

  test("salida huérfana → EXIT_WITHOUT_ENTRY, 0 min", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "stockOut" });
    await seed(emp.id, "EXIT", at("2026-01-15", 10));

    const res = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    const row = body.data[0];
    expect(row).toMatchObject({
      hasRecords: true,
      workedMinutes: 0,
      sessionCount: 1,
      incidents: ["EXIT_WITHOUT_ENTRY"],
    });
  });

  test("persona sin registros aparece con la fila en ceros", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "vacia" });

    const res = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      employeeId: emp.id,
      hasRecords: false,
      workedMinutes: 0,
      sessionCount: 0,
      daysWithRecords: 0,
      incidents: [],
      firstEntryAt: null,
      lastExitAt: null,
    });
  });

  test("anulados se excluyen: void del EXIT deja ENTRY_WITHOUT_EXIT; void de ambos deja sin registros", async ({
    ctxAdmin,
  }) => {
    const onlyEntry = await createEmployee({ suffix: "void-exit" });
    const entryId = await seed(onlyEntry.id, "ENTRY", at("2026-01-15", 8));
    const exitId = await seed(onlyEntry.id, "EXIT", at("2026-01-15", 17));
    expect(entryId).toBeTruthy();
    await voidEntry(exitId);

    const resA = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: onlyEntry.id },
    });
    const rowA = ((await resA.json()) as { data: Array<Record<string, unknown>> }).data[0];
    expect(rowA).toMatchObject({ hasRecords: true, workedMinutes: 0, incidents: ["ENTRY_WITHOUT_EXIT"] });

    const both = await createEmployee({ suffix: "void-ambos" });
    await voidEntry(await seed(both.id, "ENTRY", at("2026-01-15", 8)));
    await voidEntry(await seed(both.id, "EXIT", at("2026-01-15", 17)));

    const resB = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: both.id },
    });
    const rowB = ((await resB.json()) as { data: Array<Record<string, unknown>> }).data[0];
    expect(rowB).toMatchObject({ hasRecords: false, workedMinutes: 0, incidents: [] });
  });

  test("turno que cruza medianoche cuenta en el día de la entrada, no en el de la salida", async ({
    ctxAdmin,
  }) => {
    const emp = await createEmployee({ suffix: "noche" });
    await seed(emp.id, "ENTRY", at("2026-01-15", 22));
    await seed(emp.id, "EXIT", at("2026-01-16", 6));

    const resD = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const bodyD = (await resD.json()) as { data: Array<Record<string, unknown>> };
    expect(bodyD.data[0]).toMatchObject({ workedMinutes: 480, sessionCount: 1, daysWithRecords: 1 });
    const days = bodyD.data[0].days as Array<Record<string, unknown>>;
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-01-15", crossesMidnight: true });

    const resD1 = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-16", tz: TZ, employeeId: emp.id },
    });
    const bodyD1 = (await resD1.json()) as { data: Array<Record<string, unknown>> };
    expect(bodyD1.data[0]).toMatchObject({ workedMinutes: 0, sessionCount: 0, hasRecords: false });
  });

  test("SEMANA miércoles→miércoles: solo los días dentro de la semana cuentan", async ({
    ctxAdmin,
  }) => {
    const emp = await createEmployee({ suffix: "semana" });
    // Fuera: martes previo al miércoles de arranque.
    await seed(emp.id, "ENTRY", at("2026-01-13", 9));
    await seed(emp.id, "EXIT", at("2026-01-13", 13));
    // Dentro: miércoles de arranque y martes de cierre (la semana es mié→mié).
    await seed(emp.id, "ENTRY", at("2026-01-14", 9));
    await seed(emp.id, "EXIT", at("2026-01-14", 13));
    await seed(emp.id, "ENTRY", at("2026-01-20", 9));
    await seed(emp.id, "EXIT", at("2026-01-20", 13));
    // Fuera: miércoles siguiente (nuevo arranque).
    await seed(emp.id, "ENTRY", at("2026-01-21", 9));

    const res = await report(ctxAdmin, {
      filters: { period: "WEEK", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({ daysWithRecords: 2, sessionCount: 2, workedMinutes: 480 });
  });

  test("MES: primer y último día del mes cuentan", async ({ ctxAdmin }) => {
    const emp = await createEmployee({ suffix: "mes" });
    await seed(emp.id, "ENTRY", at("2026-01-01", 9));
    await seed(emp.id, "EXIT", at("2026-01-01", 13));
    await seed(emp.id, "ENTRY", at("2026-01-31", 9));
    await seed(emp.id, "EXIT", at("2026-01-31", 13));

    const res = await report(ctxAdmin, {
      filters: { period: "MONTH", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({ daysWithRecords: 2, sessionCount: 2, workedMinutes: 480 });
  });

  test("universo: activos sin eventos, roles ajenos con eventos, y bajas según includeInactive", async ({
    ctxAdmin,
  }) => {
    const active = await createEmployee({ suffix: "activo-sin-eventos" });
    const admin = await createEmployee({ suffix: "admin-con-eventos", role: "ADMIN" });
    const guard = await createEmployee({ suffix: "guard-con-eventos", role: "GUARD" });
    const retirement = await createEmployee({ suffix: "baja-sin-eventos", active: false });
    await seed(admin.id, "ENTRY", at("2026-01-15", 9));
    await seed(guard.id, "ENTRY", at("2026-01-15", 9));

    const withoutRetirements = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN },
    });
    const idsWithout = ((await withoutRetirements.json()) as { data: Array<{ employeeId: string }> }).data.map(
      (r) => r.employeeId
    );
    expect(idsWithout).toContain(active.id);
    expect(idsWithout).toContain(admin.id);
    expect(idsWithout).toContain(guard.id);
    expect(idsWithout).not.toContain(retirement.id);

    const withRetirements = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN, includeInactive: true },
    });
    const idsWith = ((await withRetirements.json()) as { data: Array<{ employeeId: string }> }).data.map(
      (r) => r.employeeId
    );
    expect(idsWith).toContain(retirement.id);
  });

  test("departamento: una persona sin departamento aparece con departmentName=null y el filtro acota", async ({
    ctxAdmin,
  }) => {
    const deptA = await createDepartment("A");
    const deptB = await createDepartment("B");
    const empA = await createEmployee({ suffix: "depto-a", departmentId: deptA });
    await createEmployee({ suffix: "depto-b", departmentId: deptB });
    const withoutDept = await createEmployee({ suffix: "sin-depto", departmentId: null });

    const all = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN },
    });
    const rows = ((await all.json()) as {
      data: Array<{ employeeId: string; departmentId: string | null; departmentName: string | null }>;
    }).data;
    const without = rows.find((r) => r.employeeId === withoutDept.id);
    expect(without).toBeDefined();
    expect(without?.departmentId).toBeNull();
    expect(without?.departmentName).toBeNull();

    const capped = await report(ctxAdmin, {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, departmentId: deptA },
    });
    const rowsA = ((await capped.json()) as { data: Array<{ employeeId: string }> }).data;
    expect(rowsA.map((r) => r.employeeId)).toEqual([empA.id]);
  });

  test("permisos: sin token 401; GUARD/EMPLEADO 403; ADMIN/GERENTE/RECURSOS_HUMANOS 200", async ({
    ctxAdmin,
    ctxGuard,
    ctxEmployee,
    ctxAnonymous,
  }) => {
    const manager = await createEmployee({ suffix: "manager", role: "MANAGER" });
    const rh = await createEmployee({ suffix: "rh", role: "HUMAN_RESOURCES" });
    const ctxManager = await contextFor(`e2e_report_${RUN}_gerente`.toLowerCase());
    const ctxRh = await contextFor(`e2e_report_${RUN}_rh`.toLowerCase());
    expect(manager.id).toBeTruthy();
    expect(rh.id).toBeTruthy();

    const body: ReportBody = {
      filters: { period: "DAY", date: "2026-01-15", tz: TZ },
    };

    expect((await report(ctxAnonymous, body)).status()).toBe(401);
    expect((await report(ctxGuard, body)).status()).toBe(403);
    expect((await report(ctxEmployee, body)).status()).toBe(403);
    expect((await report(ctxAdmin, body)).status()).toBe(200);
    expect((await report(ctxManager, body)).status()).toBe(200);
    expect((await report(ctxRh, body)).status()).toBe(200);
  });

  test("validación: period/date/tz inválidos → 400 con code", async ({ ctxAdmin }) => {
    const base = { period: "DAY", date: "2026-01-15", tz: TZ };

    const badPeriod = await report(ctxAdmin, { filters: { ...base, period: "YEAR" } });
    expect(badPeriod.status()).toBe(400);
    expect(((await badPeriod.json()) as { code?: string }).code).toBe("INVALID_REPORT_PERIOD");

    const badDate = await report(ctxAdmin, { filters: { ...base, date: "15/01/2026" } });
    expect(badDate.status()).toBe(400);
    expect(((await badDate.json()) as { code?: string }).code).toBe("INVALID_REPORT_DATE");

    const badTz = await report(ctxAdmin, { filters: { ...base, tz: "Marte/Olympus" } });
    expect(badTz.status()).toBe(400);
    expect(((await badTz.json()) as { code?: string }).code).toBe("INVALID_TIMEZONE");
  });

  test("summary global: consistente entre páginas y con la exportación", async ({ ctxAdmin }) => {
    const withRecords = await createEmployee({ suffix: "suma-registros" });
    await createEmployee({ suffix: "suma-sin-registros" });
    await createEmployee({ suffix: "suma-tercero" });
    await seed(withRecords.id, "ENTRY", at("2026-01-15", 8));
    await seed(withRecords.id, "EXIT", at("2026-01-15", 16));

    const filters = { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN };
    const page1 = (await (await report(ctxAdmin, { page: 1, limit: 1, filters })).json()) as {
      summary: Record<string, unknown>;
      total: number;
      hasNextPage: boolean;
      data: unknown[];
    };
    const page2 = (await (await report(ctxAdmin, { page: 2, limit: 1, filters })).json()) as {
      summary: Record<string, unknown>;
    };
    expect(page2.summary).toEqual(page1.summary);

    const summary = page1.summary as {
      peopleTotal: number;
      peopleWithRecords: number;
      peopleWithoutRecords: number;
      totalWorkedMinutes: number;
    };
    expect(summary.peopleWithRecords + summary.peopleWithoutRecords).toBe(summary.peopleTotal);

    const exp = (await (await reportExport(ctxAdmin, { filters })).json()) as {
      total: number;
      data: Array<{ workedMinutes: number }>;
      summary: { peopleTotal: number; totalWorkedMinutes: number };
    };
    expect(exp.total).toBe(summary.peopleTotal);
    expect(exp.data).toHaveLength(summary.peopleTotal);
    const sumMinutes = exp.data.reduce((acc, r) => acc + r.workedMinutes, 0);
    expect(sumMinutes).toBe(exp.summary.totalWorkedMinutes);
  });

  test("paginación: limit acotado a 100, page=2 y export sin paginar", async ({ ctxAdmin }) => {
    await createEmployee({ suffix: "pag-1" });
    await createEmployee({ suffix: "pag-2" });
    await createEmployee({ suffix: "pag-3" });
    const filters = { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN };

    const capped = (await (await report(ctxAdmin, { page: 1, limit: 1000, filters })).json()) as {
      limit: number;
      data: unknown[];
    };
    expect(capped.limit).toBeLessThanOrEqual(100);

    const page2 = (await (await report(ctxAdmin, { page: 2, limit: 1, filters })).json()) as {
      page: number;
      data: unknown[];
    };
    expect(page2.page).toBe(2);
    expect(page2.data.length).toBeLessThanOrEqual(1);

    const exp = (await (await reportExport(ctxAdmin, { filters })).json()) as {
      total: number;
      data: unknown[];
    };
    expect(exp.data).toHaveLength(exp.total);
    expect(exp.total).toBeGreaterThanOrEqual(3);
  });

  test("limit como string numérico se coacciona, se clampa a 100 y conserva filters", async ({
    ctxAdmin,
  }) => {
    const emp = await createEmployee({ suffix: "limit-str" });
    await seed(emp.id, "ENTRY", at("2026-01-15", 8));

    const res = await report(ctxAdmin, {
      page: 1,
      limit: "1000" as unknown as number,
      filters: { period: "DAY", date: "2026-01-15", tz: TZ, employeeId: emp.id },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { limit: number; data: Array<{ employeeId: string }> };
    expect(body.limit).toBeLessThanOrEqual(100);
    // `filters` sobrevive la coerción: la fila del empleado acotado sigue ahí.
    expect(body.data).toHaveLength(1);
    expect(body.data[0].employeeId).toBe(emp.id);
  });

  test("sort: una key fuera del allowlist respeta direction=desc (fallback por nombre)", async ({
    ctxAdmin,
  }) => {
    const a = await createEmployee({ suffix: "sort-a" });
    const b = await createEmployee({ suffix: "sort-b" });
    const filters = { period: "DAY", date: "2026-01-15", tz: TZ, q: RUN };

    const asc = await report(ctxAdmin, { filters, sort: { key: "nonexistent", direction: "asc" } });
    const desc = await report(ctxAdmin, { filters, sort: { key: "nonexistent", direction: "desc" } });
    const namesAsc = ((await asc.json()) as { data: Array<{ employeeName: string }> }).data.map(
      (r) => r.employeeName
    );
    const namesDesc = ((await desc.json()) as { data: Array<{ employeeName: string }> }).data.map(
      (r) => r.employeeName
    );

    expect(namesAsc).toHaveLength(2);
    expect(namesAsc[0]).toBe(a.name);
    expect(namesDesc).toEqual([...namesAsc].reverse());
    expect(namesDesc[0]).toBe(b.name);
  });

  test("TZ unificada: sys_config fija el mismo boundary en /access/query y /access/report", async ({
    ctxAdmin,
  }) => {
    const TZ_KEY = "ACCESS_REPORT_TIMEZONE";
    const CONFIG_TZ = "Asia/Tokyo"; // UTC+9, distinta del default del proceso
    const original = await db.sysConfig.findUnique({ where: { key: TZ_KEY } });

    try {
      const put = await ctxAdmin.put(`sys-config/${TZ_KEY}`, {
        data: { value: CONFIG_TZ, description: "E2E" },
      });
      expect(put.status()).toBe(200);

      const emp = await createEmployee({ suffix: "tz-config" });
      // 2026-01-15T20:00Z = 2026-01-16 05:00 en Asia/Tokyo (dentro del 16),
      // pero 2026-01-15 14:00 en America/Mexico_City (fuera del 16).
      await seed(emp.id, "ENTRY", new Date("2026-01-15T20:00:00.000Z"));

      // El reporte (que ya leía sys_config) fija el boundary oficial.
      const rep = await report(ctxAdmin, {
        filters: { period: "DAY", date: "2026-01-16", employeeId: emp.id },
      });
      expect(rep.status()).toBe(200);
      const repBody = (await rep.json()) as {
        data: Array<{ employeeId: string; hasRecords: boolean }>;
        summary: { range: { start: string; end: string; timezone: string } };
      };
      expect(repBody.summary.range.timezone).toBe(CONFIG_TZ);
      expect(repBody.summary.range.start).toBe("2026-01-15T15:00:00.000Z");
      expect(repBody.summary.range.end).toBe("2026-01-16T15:00:00.000Z");
      expect(repBody.data[0]).toMatchObject({ employeeId: emp.id, hasRecords: true });

      // La bitácora debe usar el MISMO boundary, sin `filters.tz` explícito.
      const qry = await ctxAdmin.post("access/query", {
        data: {
          page: 1,
          limit: 10,
          filters: { employeeId: emp.id, start: "2026-01-16", end: "2026-01-16" },
        },
      });
      expect(qry.status()).toBe(200);
      expect(((await qry.json()) as { total: number }).total).toBe(1);
    } finally {
      if (original) {
        await ctxAdmin.put(`sys-config/${TZ_KEY}`, {
          data: { value: original.value, description: original.description ?? undefined },
        });
      } else {
        await ctxAdmin.delete(`sys-config/${TZ_KEY}`);
      }
    }
  });
});
