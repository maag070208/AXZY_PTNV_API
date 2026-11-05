import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — revisión por departamento y cierre de la pre-nómina
 * (`/schedules/payroll/*`): quién revisó cada departamento, si fue uno por uno
 * o con «marcar todo», y el cierre/reapertura de la semana con su fotografía.
 *
 * Se usa una semana del pasado (`2020-01-06`) y un departamento `E2E` propio;
 * todo se borra al final, así que la pre-nómina real no se toca.
 */
assertSafeDatabase();

const RUN = newRunId();
const WEEK = "2020-01-06"; // lunes
const DEPT_NAME = `${E2E_PREFIX} Depto PreNómina ${RUN}`;

let deptId: string;

test.beforeAll(async () => {
  const dept = await db.department.create({ data: { name: DEPT_NAME } });
  deptId = dept.id;
});

test.afterAll(async () => {
  await db.payrollDepartmentReview.deleteMany({ where: { weekStart: new Date(`${WEEK}T00:00:00.000Z`) } });
  await db.payrollWeekClosure.deleteMany({ where: { weekStart: new Date(`${WEEK}T00:00:00.000Z`) } });
  await db.auditLog.deleteMany({
    where: { entityType: { in: ["PayrollWeekClosure", "PayrollDepartmentReview"] }, entityId: { startsWith: WEEK } },
  });
  await db.department.deleteMany({ where: { name: DEPT_NAME } });
});

test.describe("Pre-nómina — revisión y cierre (E2E)", () => {
  test("sin sesión responde 401 y un empleado sin permiso 403", async ({ ctxAnonymous, ctxEmployee }) => {
    expect((await ctxAnonymous.get(`schedules/payroll/review-state?weekStart=${WEEK}`)).status()).toBe(401);
    expect((await ctxEmployee.get(`schedules/payroll/review-state?weekStart=${WEEK}`)).status()).toBe(403);
    expect(
      (await ctxEmployee.put("schedules/payroll/reviews", { data: { weekStart: WEEK, departmentId: null, reviewed: true } }))
        .status()
    ).toBe(403);
    expect((await ctxEmployee.post("schedules/payroll/close", { data: { weekStart: WEEK, departmentIds: [] } })).status()).toBe(
      403
    );
  });

  test("la semana arranca abierta y sin revisiones", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get(`schedules/payroll/review-state?weekStart=${WEEK}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { closed: boolean; reviews: unknown[] };
    expect(body.closed).toBe(false);
    expect(body.reviews).toHaveLength(0);
  });

  test("revisión individual (bulk=false) con sello de quién y cuándo", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put("schedules/payroll/reviews", {
      data: { weekStart: WEEK, departmentId: null, reviewed: true },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      reviews: { departmentId: string | null; bulk: boolean; reviewedBy: { name: string } | null }[];
    };
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ departmentId: null, bulk: false });
    expect(body.reviews[0].reviewedBy?.name).toBeTruthy();
  });

  test("«marcar todo» crea solo las que faltan, con bulk=true", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/payroll/reviews/mark-all", {
      data: { weekStart: WEEK, departmentIds: [deptId, null] },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { reviews: { departmentId: string | null; bulk: boolean }[] };
    expect(body.reviews).toHaveLength(2);
    // La del grupo sin departamento ya existía como individual: conserva bulk=false.
    expect(body.reviews.find((r) => r.departmentId === null)?.bulk).toBe(false);
    expect(body.reviews.find((r) => r.departmentId === deptId)?.bulk).toBe(true);

    // Repetir «marcar todo» no duplica revisiones (índice único funcional).
    const again = await ctxAdmin.post("schedules/payroll/reviews/mark-all", {
      data: { weekStart: WEEK, departmentIds: [deptId, null] },
    });
    const againBody = (await again.json()) as { reviews: unknown[] };
    expect(againBody.reviews).toHaveLength(2);
  });

  test("cerrar exige que todos los departamentos estén revisados (409)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/payroll/close", {
      data: { weekStart: WEEK, departmentIds: [deptId, null, "depto-sin-revisar"] },
    });
    expect(res.status(), await res.text()).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("DEPARTMENTS_PENDING_REVIEW");
  });

  test("cerrar guarda la fotografía y reabrir deja su sello", async ({ ctxAdmin }) => {
    const snapshot = { people: 10, workedMin: 24000, extraMin: 120, absences: 1 };
    const close = await ctxAdmin.post("schedules/payroll/close", {
      data: { weekStart: WEEK, departmentIds: [deptId, null], snapshot },
    });
    expect(close.status(), await close.text()).toBe(200);
    const closed = (await close.json()) as {
      closed: boolean;
      closure: { snapshot: unknown; closedBy: { name: string } | null; reopenedAt: string | null };
    };
    expect(closed.closed).toBe(true);
    expect(closed.closure.snapshot).toMatchObject(snapshot);
    expect(closed.closure.closedBy?.name).toBeTruthy();
    expect(closed.closure.reopenedAt).toBeNull();

    const reopen = await ctxAdmin.post("schedules/payroll/reopen", { data: { weekStart: WEEK } });
    expect(reopen.status(), await reopen.text()).toBe(200);
    const reopened = (await reopen.json()) as { closed: boolean; closure: { reopenedAt: string | null } };
    expect(reopened.closed).toBe(false);
    expect(reopened.closure.reopenedAt).not.toBeNull();

    // Reabrir una semana que no está cerrada: 409.
    const again = await ctxAdmin.post("schedules/payroll/reopen", { data: { weekStart: WEEK } });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("PAYROLL_NOT_CLOSED");
  });

  test("el historial lista la semana con su fotografía y su estado", async ({ ctxAdmin, ctxEmployee }) => {
    expect((await ctxEmployee.get("schedules/payroll/closures")).status()).toBe(403);

    const res = await ctxAdmin.get("schedules/payroll/closures");
    expect(res.status(), await res.text()).toBe(200);
    const rows = (await res.json()) as {
      weekStart: string;
      closed: boolean;
      closedBy: { name: string } | null;
      reopenedAt: string | null;
      snapshot: { people?: number } | null;
    }[];
    const row = rows.find((r) => r.weekStart === WEEK);
    expect(row, "la semana del spec debe estar en el historial").toBeTruthy();
    // Quedó reabierta en la prueba anterior, con su sello y su fotografía.
    expect(row?.closed).toBe(false);
    expect(row?.reopenedAt).not.toBeNull();
    expect(row?.closedBy?.name).toBeTruthy();
    expect(row?.snapshot?.people).toBe(10);
  });

  test("quitar la revisión borra la fila", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put("schedules/payroll/reviews", {
      data: { weekStart: WEEK, departmentId: deptId, reviewed: false },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { reviews: { departmentId: string | null }[] };
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].departmentId).toBeNull();

    // Vuelve a quedar como estaba para otros specs.
    await ctxAdmin.put("schedules/payroll/reviews", { data: { weekStart: WEEK, departmentId: null, reviewed: false } });
  });

  test("validación: weekStart con formato inválido responde 400", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("schedules/payroll/review-state?weekStart=06-01-2020");
    expect(res.status()).toBe(400);
  });
});
