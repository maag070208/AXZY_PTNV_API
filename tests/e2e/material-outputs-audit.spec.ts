import { test, expect } from "./support/fixtures";
import { db, statusesInDb } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — salidas de material (`/material-outputs`) y bitácora
 * (`/audit`).
 *
 * Las salidas se ligan a una unidad de un dispositivo `E2E` (el `scenario`),
 * así el teardown global las limpia; además se borran aquí por id. La auditoría
 * se prueba de solo lectura sobre los registros que ya existen.
 */
assertSafeDatabase();

const RUN = newRunId();
const DESCRIPTION = `${E2E_PREFIX} Salida ${RUN}`;
const DEPARTMENT = `${E2E_PREFIX} Depto salida ${RUN}`;
const USER = `${E2E_PREFIX} Usuario salida ${RUN}`;

let outputId = "";
let lockedOutputId = "";

test.afterAll(async () => {
  if (outputId) await db.materialOutput.deleteMany({ where: { id: outputId } });
  if (lockedOutputId) await db.materialOutput.deleteMany({ where: { id: lockedOutputId } });
});

test.describe("Salidas de material (E2E)", () => {
  test("sin token es 401; EMPLEADO puede listar pero no registrar", async ({
    ctxAnonymous,
    ctxEmployee,
  }) => {
    expect((await ctxAnonymous.get("material-outputs")).status()).toBe(401);
    expect((await ctxEmployee.get("material-outputs")).status()).toBe(200);
    expect(
      (
        await ctxEmployee.post("material-outputs", {
          data: { description: "x", departmentName: DEPARTMENT, userName: USER },
        })
      ).status()
    ).toBe(403);
  });

  test("ADMIN registra una salida ligada a una unidad y la deja en BAJA", async ({
    ctxAdmin,
    inv,
    scenario,
  }) => {
    const device = await scenario.device(1);
    const [unit] = await inv.units(device.id);

    const res = await ctxAdmin.post("material-outputs", {
      data: {
        description: DESCRIPTION,
        departmentName: DEPARTMENT,
        userName: USER,
        reason: "DAMAGED",
        deviceUnitId: unit.id,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { id: string; reason: string; deviceUnit: { id: string } };
    expect(body).toMatchObject({ reason: "DAMAGED", deviceUnit: { id: unit.id } });
    outputId = body.id;

    // La unidad física pasa a BAJA (la salida implica que ya no sirve).
    expect(await statusesInDb(device.id)).toMatchObject({ RETIRED: 1 });
  });

  test("valida el body: descripción vacía y motivo inválido son 400", async ({ ctxAdmin }) => {
    expect(
      (
        await ctxAdmin.post("material-outputs", {
          data: { description: "", departmentName: DEPARTMENT, userName: USER },
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await ctxAdmin.post("material-outputs", {
          data: { description: "ok", departmentName: DEPARTMENT, userName: USER, reason: "NOPE" },
        })
      ).status()
    ).toBe(400);
  });

  test("detalle, tabla, sugerencias y actualización", async ({ ctxAdmin }) => {
    const one = await ctxAdmin.get(`material-outputs/${outputId}`);
    expect(one.status()).toBe(200);
    expect((await one.json()).description).toBe(DESCRIPTION);

    const table = await ctxAdmin.post("material-outputs/query", {
      data: {
        page: 1,
        limit: 10,
        filters: { q: DESCRIPTION },
        sort: { key: "date", direction: "desc" },
      },
    });
    expect(table.status()).toBe(200);
    expect((await table.json()).total).toBeGreaterThanOrEqual(1);

    const suggestions = await ctxAdmin.get("material-outputs/suggestions");
    expect(suggestions.status()).toBe(200);
    expect(Array.isArray((await suggestions.json()).departmentName)).toBe(true);

    const updated = await ctxAdmin.put(`material-outputs/${outputId}`, {
      data: { notes: "nota E2E" },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await updated.json()).notes).toBe("nota E2E");

    const removed = await ctxAdmin.delete(`material-outputs/${outputId}`);
    expect(removed.status()).toBe(200);
    outputId = "";
  });

  test("rechaza dar salida a una unidad prestada (409)", async ({
    ctxAdmin,
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(2);
    const [unit] = await inv.units(device.id);
    await inv.lend({ departmentId, items: [{ deviceId: device.id, unitIds: [unit.id] }] });

    const res = await ctxAdmin.post("material-outputs", {
      data: {
        description: `${E2E_PREFIX} salida prestada ${unit.assetTag}`,
        departmentName: DEPARTMENT,
        userName: USER,
        reason: "DAMAGED",
        deviceUnitId: unit.id,
      },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ code: "UNIT_UNEXPECTED_STATUS" });
    // La unidad sigue prestada: la salida no se registró.
    expect(await inv.stock(device.id)).toMatchObject({ ON_LOAN: 1, RETIRED: 0 });
  });

  test("no deja cambiar la unidad de una salida ya ligada (409)", async ({
    ctxAdmin,
    inv,
    scenario,
  }) => {
    const device = await scenario.device(2);
    const [first, second] = await inv.units(device.id);

    const created = await ctxAdmin.post("material-outputs", {
      data: {
        description: `${E2E_PREFIX} bloqueo unidad ${RUN}`,
        departmentName: DEPARTMENT,
        userName: USER,
        reason: "OBSOLETE",
        deviceUnitId: first.id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    lockedOutputId = ((await created.json()) as { id: string }).id;

    const res = await ctxAdmin.put(`material-outputs/${lockedOutputId}`, {
      data: { deviceUnitId: second.id },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ code: "MATERIAL_OUTPUT_UNIT_LOCKED" });
  });
});

test.describe("Auditoría (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("audit")).status()).toBe(401);
  });

  test("lista bitácora con paginación y permite filtrar", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.get("audit?page=1&limit=20");
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; action: string; entityType: string }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(Array.isArray(body.data)).toBe(true);

    if (body.data.length > 0) {
      const sample = body.data[0];
      const filtered = await ctxAdmin.get(`audit?entityType=${sample.entityType}&limit=50`);
      expect(filtered.status()).toBe(200);
      const rows = (await filtered.json()).data as Array<{ entityType: string }>;
      expect(rows.every((r) => r.entityType === sample.entityType)).toBe(true);

      const one = await ctxAdmin.get(`audit/${sample.id}`);
      expect(one.status()).toBe(200);
      expect((await one.json()).id).toBe(sample.id);
    }
  });

  test("un id inexistente es 404", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.get("audit/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
  });
});
