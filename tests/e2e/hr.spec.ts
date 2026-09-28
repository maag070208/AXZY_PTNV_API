import bcrypt from "bcryptjs";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — Recursos Humanos: personal (`/hr`), catálogos de documentos,
 * y reportes disciplinarios.
 *
 * `hr.records` / `hr.disciplinary_reports` los tienen ADMIN, MANAGER y
 * HUMAN_RESOURCES; `catalogs.manage` ADMIN y MANAGER. El EMPLEADO no ve nada
 * de esto (403). El usuario de prueba y lo que se crea se limpia al terminar.
 */
assertSafeDatabase();

const RUN = newRunId();
const USERNAME = `e2e_hr_${RUN}`.toLowerCase();
const DOC_TYPE = `${E2E_PREFIX} Tipo doc ${RUN}`;

let userId = "";
let documentTypeId = "";
let reportId = "";

test.beforeAll(async () => {
  const department = await db.department.findFirst({ select: { id: true } });
  const password = await bcrypt.hash("e2e-not-used-123", 10);
  const user = await db.user.create({
    data: {
      username: USERNAME,
      name: "E2E RRHH Persona",
      role: "EMPLOYEE",
      password,
      employeeNumber: `${E2E_PREFIX}${RUN}`,
      jobTitle: "Auxiliar",
      departmentId: department?.id ?? null,
    },
    select: { id: true },
  });
  userId = user.id;
});

test.afterAll(async () => {
  await db.disciplinaryReport.deleteMany({ where: { userId } });
  if (documentTypeId) await db.documentType.deleteMany({ where: { id: documentTypeId } });
  await db.employeeDiscount.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

test.describe("RRHH — personal (E2E)", () => {
  test("sin token es 401; EMPLEADO no tiene hr.records (403)", async ({
    ctxAnonymous,
    ctxEmployee,
  }) => {
    expect((await ctxAnonymous.post("hr/query", { data: { page: 1, limit: 10 } })).status()).toBe(401);
    expect((await ctxEmployee.post("hr/query", { data: { page: 1, limit: 10 } })).status()).toBe(403);
    expect((await ctxEmployee.get("hr/stats")).status()).toBe(403);
    expect((await ctxEmployee.get(`hr/${userId}`)).status()).toBe(403);
  });

  test("tabla de personal (200) y estadísticas", async ({ ctxAdmin }) => {
    const table = await ctxAdmin.post("hr/query", {
      data: { page: 1, limit: 10, filters: { name: "E2E RRHH Persona" }, sort: { key: "name", direction: "asc" } },
    });
    expect(table.status(), await table.text()).toBe(200);
    const body = (await table.json()) as { data: unknown[]; total: number };
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");

    const stats = await ctxAdmin.get("hr/stats");
    expect(stats.status()).toBe(200);
    expect(await stats.json()).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      inactive: expect.any(Number),
      roles: {
        MANAGER: expect.any(Number),
        AREA_HEAD: expect.any(Number),
        EMPLOYEE: expect.any(Number),
      },
    });
  });

  test("detalle del perfil (200)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get(`hr/${userId}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id: userId, username: USERNAME, role: "EMPLOYEE" });
  });

  test("actualiza el perfil y valida el código postal (400)", async ({ ctxAdmin }) => {
    const ok = await ctxAdmin.patch(`hr/${userId}/profile`, {
      data: { city: "Tijuana", postalCode: "22000", personalPhone: "6641234567" },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await ok.json()).toMatchObject({ city: "Tijuana", postalCode: "22000" });

    const bad = await ctxAdmin.patch(`hr/${userId}/profile`, { data: { postalCode: "abc" } });
    expect(bad.status()).toBe(400);
  });

  test("fija descuentos (200) y rechaza un tipo inválido (400)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put(`hr/${userId}/discounts`, {
      data: { discounts: [{ type: "IMSS", note: "E2E" }, { type: "INFONAVIT" }] },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { discounts: Array<{ type: string }> };
    expect(body.discounts.map((d) => d.type).sort()).toEqual(["IMSS", "INFONAVIT"]);

    const bad = await ctxAdmin.put(`hr/${userId}/discounts`, {
      data: { discounts: [{ type: "NOPE" }] },
    });
    expect(bad.status()).toBe(400);
  });

  test("documentos del empleado (200, lista vacía) y acceso denegado al empleado", async ({
    ctxAdmin,
    ctxEmployee,
  }) => {
    const res = await ctxAdmin.get(`hr/${userId}/documents`);
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
    expect((await ctxEmployee.get(`hr/${userId}/documents`)).status()).toBe(403);
  });
});

test.describe("RRHH — catálogos de documentos (E2E)", () => {
  test("EMPLEADO no puede leer el catálogo (403); ADMIN sí (200)", async ({
    ctxAdmin,
    ctxEmployee,
  }) => {
    expect((await ctxEmployee.get("hr/catalogs/document-types")).status()).toBe(403);
    expect((await ctxAdmin.get("hr/catalogs/document-types")).status()).toBe(200);
  });

  test("CRUD del tipo de documento", async ({ ctxAdmin, ctxEmployee }) => {
    expect((await ctxEmployee.post("hr/catalogs/document-types", { data: { name: DOC_TYPE } })).status()).toBe(403);

    const created = await ctxAdmin.post("hr/catalogs/document-types", {
      data: { name: DOC_TYPE, sortOrder: 99 },
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = (await created.json()) as { id: string; name: string; active: boolean };
    expect(body).toMatchObject({ name: DOC_TYPE, active: true });
    documentTypeId = body.id;

    const patched = await ctxAdmin.patch(`hr/catalogs/document-types/${documentTypeId}`, {
      data: { active: false },
    });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).active).toBe(false);

    const removed = await ctxAdmin.delete(`hr/catalogs/document-types/${documentTypeId}`);
    expect(removed.status()).toBe(200);
    documentTypeId = "";
  });
});

test.describe("RRHH — reportes disciplinarios (E2E)", () => {
  test("EMPLEADO no tiene hr.disciplinary_reports (403)", async ({ ctxEmployee }) => {
    expect((await ctxEmployee.post("hr/disciplinary-reports", { data: {} })).status()).toBe(403);
  });

  test("ADMIN crea (201), consulta y elimina el reporte", async ({ ctxAdmin }) => {
    const created = await ctxAdmin.post("hr/disciplinary-reports", {
      data: {
        userId,
        reason: "ABSENCE",
        incidentDate: "2026-01-10",
        description: `${E2E_PREFIX} Falta ${RUN}`,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = (await created.json()) as { id: string; reason: string; user: { id: string } };
    expect(body).toMatchObject({ reason: "ABSENCE", user: { id: userId } });
    reportId = body.id;

    const one = await ctxAdmin.get(`hr/disciplinary-reports/${reportId}`);
    expect(one.status()).toBe(200);
    expect((await one.json()).id).toBe(reportId);

    const byEmployee = await ctxAdmin.get(`hr/disciplinary-reports/employee/${userId}`);
    expect(byEmployee.status()).toBe(200);
    expect((await byEmployee.json()).some((r: { id: string }) => r.id === reportId)).toBe(true);

    const query = await ctxAdmin.post("hr/disciplinary-reports/query", {
      data: { page: 1, limit: 10, filters: { userId }, sort: { key: "incidentDate", direction: "desc" } },
    });
    expect(query.status()).toBe(200);
    expect((await query.json()).total).toBeGreaterThanOrEqual(1);

    const removed = await ctxAdmin.delete(`hr/disciplinary-reports/${reportId}`);
    expect(removed.status()).toBe(200);
    reportId = "";
  });
});
