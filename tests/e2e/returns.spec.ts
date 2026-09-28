import { test, expect } from "./support/fixtures";
import type { LoanReturn } from "./support/inventory-api";

/**
 * LISTADO DE DEVOLUCIONES — `GET /inventory/returns` (BLINDAJE.md §7).
 *
 * Cubre el endpoint de listado (forma del arreglo y datos de la devolución), el
 * filtro `?loanId=` y la autorización, más las validaciones del DTO de la
 * devolución (`DUPLICATE_UNITS`, `QUANTITY_UNITS_MISMATCH`).
 */
const fieldMessage = (body: unknown, message: string): void => {
  expect(JSON.stringify(body)).toContain(message);
};

test.describe("LISTADO de devoluciones (E2E)", () => {
  test("lista las devoluciones con su forma y con la devolución registrada", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(4);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 2 }],
    });
    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId: loan.items[0].id, quantity: 2, condition: "GOOD" }],
    });

    const returns = await inv.listReturns();
    expect(Array.isArray(returns)).toBe(true);

    const own = returns.find((r) => r.loanId === loan.id);
    expect(own).toBeDefined();
    expect(own).toMatchObject({
      loanId: loan.id,
      loan: { id: loan.id, number: loan.number },
    });
    expect(own?.number).toMatch(/^DEV-\d{4}$/);
    expect(own?.items).toHaveLength(1);
    expect(own?.items[0]).toMatchObject({ deviceId: device.id, quantity: 2, condition: "GOOD" });

    // Todos los renglones traen la forma esperada del listado.
    for (const row of returns) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.number).toBe("string");
      expect(row.loan).toMatchObject({ id: expect.any(String), number: expect.any(String) });
      expect(Array.isArray(row.items)).toBe(true);
    }
  });

  test("el filtro ?loanId= acota a las devoluciones de ese préstamo", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const first = await scenario.device(2);
    const second = await scenario.device(2);

    const loanA = await inv.lend({ departmentId, items: [{ deviceId: first.id, quantity: 1 }] });
    await inv.returnLoan({
      loanId: loanA.loan.id,
      items: [{ loanItemId: loanA.loan.items[0].id, quantity: 1, condition: "GOOD" }],
    });
    const loanB = await inv.lend({ departmentId, items: [{ deviceId: second.id, quantity: 1 }] });
    await inv.returnLoan({
      loanId: loanB.loan.id,
      items: [{ loanItemId: loanB.loan.items[0].id, quantity: 1, condition: "GOOD" }],
    });

    const onlyA = await inv.listReturns({ loanId: loanA.loan.id });
    expect(onlyA.length).toBeGreaterThanOrEqual(1);
    expect(onlyA.every((r) => r.loanId === loanA.loan.id)).toBe(true);
    expect(onlyA.some((r) => r.loan.number === loanA.loan.number)).toBe(true);
  });

  test("sin token el listado es 401", async ({ invAnonymous }) => {
    expect((await invAnonymous.get("/inventory/returns")).status).toBe(401);
  });

  test("valida el DTO de la devolución", async ({ inv, scenario, departmentId }) => {
    const device = await scenario.device(3);
    const units = await inv.units(device.id);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 2 }],
    });
    const loanItemId = loan.items[0].id;

    const duplicated = await inv.post<LoanReturn>("/inventory/returns", {
      loanId: loan.id,
      items: [{ loanItemId, unitIds: [units[0].id, units[0].id], condition: "GOOD" }],
    });
    expect(duplicated.status).toBe(400);
    expect(duplicated.body).toMatchObject({ error: "ValidationError" });
    fieldMessage(duplicated.body, "Una unidad viene repetida");

    const mismatch = await inv.post<LoanReturn>("/inventory/returns", {
      loanId: loan.id,
      items: [{ loanItemId, quantity: 3, unitIds: [units[0].id, units[1].id], condition: "GOOD" }],
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toMatchObject({ error: "ValidationError" });
    fieldMessage(mismatch.body, "La cantidad no coincide con las unidades seleccionadas");

    // Nada se movió por las peticiones inválidas.
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 1, ON_LOAN: 2 });
  });
});
