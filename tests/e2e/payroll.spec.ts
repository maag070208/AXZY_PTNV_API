import { test, expect } from "./support/fixtures";
import { assertSafeDatabase } from "./support/env";

/**
 * E2E de contrato — Nómina (`POST /schedules/weekly-attendance`).
 *
 * El reporte semanal de asistencia para RH se protege con el permiso
 * `payroll.view` (ADMIN y HUMAN_RESOURCES). Verifica el gate de permisos y la
 * forma del reporte; el cálculo de la jornada tiene su propio unit test.
 */
assertSafeDatabase();

const todayKey = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test.describe("Nómina — reporte semanal (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    const res = await ctxAnonymous.post("schedules/weekly-attendance", {
      data: { date: todayKey() },
    });
    expect(res.status()).toBe(401);
  });

  test("EMPLEADO sin payroll.view es 403", async ({ ctxEmployee }) => {
    const res = await ctxEmployee.post("schedules/weekly-attendance", {
      data: { date: todayKey() },
    });
    expect(res.status()).toBe(403);
  });

  test("RH (HUMAN_RESOURCES) tiene payroll.view y recibe el reporte", async ({ ctxHr }) => {
    const res = await ctxHr.post("schedules/weekly-attendance", {
      data: { date: todayKey() },
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      range: { days: string[] };
      rows: unknown[];
      summary: Record<string, number>;
    };
    expect(body.range.days).toHaveLength(7);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.summary).toMatchObject({
      people: expect.any(Number),
      unlinked: expect.any(Number),
      withoutSchedule: expect.any(Number),
      workedMin: expect.any(Number),
      extraMin: expect.any(Number),
      approvedExtraMin: expect.any(Number),
      absences: expect.any(Number),
      incompleteDays: expect.any(Number),
    });
  });

  test("ADMIN recibe el contrato completo de la semana", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/weekly-attendance", {
      data: { date: todayKey() },
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      range: { days: string[]; timezone: string };
      rows: Array<{ days: Array<{ status: string }> }>;
    };
    expect(body.range.days).toHaveLength(7);
    expect(new Set(body.range.days).size).toBe(7);
    expect(typeof body.range.timezone).toBe("string");

    const statuses = ["WORKED", "OVERTIME", "ABSENCE", "INCOMPLETE", "REST", "REST_WORKED", "NO_INFO", "FUTURE"];
    for (const row of body.rows) {
      expect(row.days).toHaveLength(7);
      for (const day of row.days) expect(statuses).toContain(day.status);
    }
  });

  test("un departamento inexistente deja el reporte sin filas", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/weekly-attendance", {
      data: { date: todayKey(), departmentId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; summary: { people: number } };
    expect(body.rows).toHaveLength(0);
    expect(body.summary.people).toBe(0);
  });

  test("la búsqueda q no encuentra basura", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/weekly-attendance", {
      data: { date: todayKey(), q: "zzz-no-existe-9999" },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(0);
  });

  test("una fecha con formato inválido es 400", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/weekly-attendance", {
      data: { date: "2026/13/40" },
    });
    expect(res.status()).toBe(400);
  });
});
