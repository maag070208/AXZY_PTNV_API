import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { assertSafeDatabase } from "./support/env";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E — Primer día de la semana laboral (`sys_config` → `WEEK_START_DAY`).
 *
 * El cliente opera miércoles→miércoles. El valor (nombre de día) fija el borde
 * de la semana en TODOS los filtros de periodo; sin fila o con valor inválido
 * cae en miércoles. Aquí se comprueba sobre `POST /reports/period-summary`,
 * que usa el mismo `resolveReportRange` que el reporte de acceso, el checador
 * y las horas extra.
 *
 * Restauración obligatoria: cada test guarda el valor original y lo repone en
 * `finally` (PUT si existía, DELETE si no), igual que `sys-config-email.spec.ts`.
 */
assertSafeDatabase();

const KEY = "WEEK_START_DAY";
/** Jueves: cae en la semana mié→mié que arranca el 2030-03-13. */
const DATE = "2030-03-14";

interface ConfigOriginal {
  value: string;
  description: string | null;
}

const readOriginal = async (): Promise<ConfigOriginal | null> => {
  const row = await db.sysConfig.findUnique({ where: { key: KEY } });
  return row ? { value: row.value, description: row.description } : null;
};

const restore = async (
  adminReq: APIRequestContext,
  original: ConfigOriginal | null
): Promise<void> => {
  if (original) {
    await adminReq.put(`sys-config/${KEY}`, {
      data: { value: original.value, description: original.description ?? undefined },
    });
  } else {
    await adminReq.delete(`sys-config/${KEY}`);
  }
};

const setDay = async (adminReq: APIRequestContext, value: string): Promise<void> => {
  const res = await adminReq.put(`sys-config/${KEY}`, { data: { value } });
  expect(res.status(), await res.text()).toBe(200);
};

const weekRange = async (
  adminReq: APIRequestContext
): Promise<{ start: string; end: string }> => {
  const res = await adminReq.post("reports/period-summary", {
    data: { period: "WEEK", date: DATE, timezone: "UTC" },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { range: { start: string; end: string } };
  return body.range;
};

test.describe("sys_config WEEK_START_DAY (E2E)", () => {
  test("miércoles: la semana va de miércoles a miércoles", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    try {
      await setDay(ctxAdmin, "WEDNESDAY");
      const range = await weekRange(ctxAdmin);
      expect(range.start).toBe("2030-03-13T00:00:00.000Z"); // miércoles
      expect(range.end).toBe("2030-03-20T00:00:00.000Z"); // miércoles siguiente (exclusivo)
    } finally {
      await restore(ctxAdmin, original);
    }
  });

  test("cambiar a MONDAY mueve el borde al lunes", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    try {
      await setDay(ctxAdmin, "MONDAY");
      const range = await weekRange(ctxAdmin);
      expect(range.start).toBe("2030-03-11T00:00:00.000Z"); // lunes
      expect(range.end).toBe("2030-03-18T00:00:00.000Z"); // lunes siguiente
    } finally {
      await restore(ctxAdmin, original);
    }
  });

  test("valor inválido = 400 y no cambia el guardado", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    try {
      await setDay(ctxAdmin, "WEDNESDAY");
      const bad = await ctxAdmin.put(`sys-config/${KEY}`, { data: { value: "LUNA" } });
      expect(bad.status()).toBe(400);
      const row = await db.sysConfig.findUnique({ where: { key: KEY } });
      expect(row?.value).toBe("WEDNESDAY");
    } finally {
      await restore(ctxAdmin, original);
    }
  });
});
