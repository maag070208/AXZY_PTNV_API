import { test, expect } from "./support/fixtures";
import { expectAuditCleanForDevice } from "./support/inventory-audit";
import type { InventoryAuditResult } from "./support/inventory-api";

/**
 * AUDITOR y TABLERO — AGENTS.md (auditor de inventario), BLINDAJE.md §0a, §7.
 *
 * El auditor corre 8 reglas y devuelve cuántos casos rompen cada una. Los
 * descuadres heredados del respaldo siguen ahí, así que NO se exige `ok` global
 * en la suite: se exige que el dispositivo de la prueba no aparezca.
 */
const AUDIT_KEYS = [
  "UNIT_IN_MULTIPLE_OPEN_LOANS",
  "LOAN_ITEM_PENDING_MISMATCH",
  "OPEN_LOAN_UNIT_NOT_ON_LOAN",
  "ON_LOAN_UNIT_WITHOUT_LOAN",
  "CLOSED_LOAN_WITH_OPEN_UNITS",
  "LOAN_STATUS_MISMATCH",
  "MOVEMENT_UNITS_MISMATCH",
  "LEDGER_MISMATCH",
];

test.describe("AUDITOR de inventario (E2E)", () => {
  test("responde las 8 reglas con conteos numéricos", async ({ inv }) => {
    const res = await inv.get<InventoryAuditResult>("/inventory/audit");
    expect(res.status).toBe(200);
    expect(typeof res.body.ok).toBe("boolean");
    expect(res.body.checkedAt).toBeTruthy();
    expect(res.body.checks.map((c) => c.key).sort()).toEqual([...AUDIT_KEYS].sort());
    for (const check of res.body.checks) {
      expect(typeof check.count).toBe("number");
      expect(Array.isArray(check.samples)).toBe(true);
      expect(check.samples.length).toBeLessThanOrEqual(10);
    }
  });

  test("los descuadres de movimientos vienen en piezas y con el tipo traducido", async ({ inv }) => {
    const res = await inv.get<InventoryAuditResult>("/inventory/audit");
    const check = res.body.checks.find((c) => c.key === "MOVEMENT_UNITS_MISMATCH")!;

    // En una base recién migrada puede no haber descuadres heredados.
    if (check.count === 0) test.skip(true, "esta base no tiene descuadres de movimientos");

    expect(check.rows?.length).toBe(Math.min(check.count, 10));
    for (const row of check.rows!) {
      // El rótulo sale del i18n (`label("movementType", …)`), nunca del enum de la base.
      expect(row.movementType).toBeTruthy();
      expect(row.movementType).not.toMatch(/^[A-Z_]+$/);
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.device).toBeTruthy();
      expect(typeof row.quantity).toBe("number");
      expect(typeof row.linked).toBe("number");
      // Eso es lo que rompe la regla, y por eso la fila trae las dos cifras.
      expect(row.quantity).not.toBe(row.linked);
    }
  });

  test("sin token es 401 y un EMPLEADO no tiene permiso (403)", async ({
    invAnonymous,
    invEmployee,
  }) => {
    expect((await invAnonymous.get("/inventory/audit")).status).toBe(401);
    expect((await invEmployee.get("/inventory/audit")).status).toBe(403);
  });

  test("el tablero devuelve stats y byType; sin token es 401", async ({ inv, invAnonymous, scenario }) => {
    const device = await scenario.device(2);

    const res = await inv.get<{ stats: Record<string, number>; byType: unknown[] }>(
      "/inventory/dashboard"
    );
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.stats)).toEqual(
      expect.arrayContaining([
        "types",
        "devices",
        "activeUnits",
        "available",
        "loaned",
        "damaged",
        "maintenance",
        "retirement",
      ])
    );
    expect(Array.isArray(res.body.byType)).toBe(true);
    for (const value of Object.values(res.body.stats)) expect(typeof value).toBe("number");

    expect((await invAnonymous.get("/inventory/dashboard")).status).toBe(401);
    expect(device.id).toBeTruthy();
  });

  test("un ciclo normal de la prueba no dispara casos para su dispositivo", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(3);
    const units = await inv.units(device.id);

    // Préstamo por unidad exacta y devolución: el kardex debe quedar cuadrado.
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: [units[0].id, units[1].id] }],
    });
    await inv.returnLoan({
      loanId: loan.id,
      items: [
        {
          loanItemId: loan.items[0].id,
          unitIds: [units[0].id, units[1].id],
          condition: "GOOD",
        },
      ],
    });

    await expectAuditCleanForDevice(inv, device);
  });
});
