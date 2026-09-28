import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX } from "./support/env";
import type { UnitHistory } from "./support/inventory-api";

/**
 * HISTORIAL POR UNIDAD — BLINDAJE.md §4.
 *
 * `GET /inventory/units/:id/history` une el alta/movimientos, los préstamos, las
 * devoluciones y la bitácora de una pieza, ordenado por fecha.
 */
test.afterAll(async () => {
  const units = await db.deviceUnit.findMany({
    where: { device: { type: { code: { startsWith: E2E_PREFIX } } } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({
    where: { action: "DEVICE_UNIT_UPDATED", entityId: { in: units.map((u) => u.id) } },
  });
});

test.describe("HISTORIAL por unidad (E2E)", () => {
  test("une movimientos, préstamos, devoluciones y bitácora en orden", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(3);
    const unit = (await inv.units(device.id))[0];

    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: [unit.id] }],
    });
    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId: loan.items[0].id, unitIds: [unit.id], condition: "GOOD" }],
    });
    await inv.updateUnit(unit.id, { ip: "10.7.7.7" });

    const res = await inv.get<UnitHistory>(`/inventory/units/${unit.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.unit.id).toBe(unit.id);
    expect(res.body.unit.device.id).toBe(device.id);

    const kinds = res.body.history.map((h) => h.kind);
    expect(kinds).toContain("MOVEMENT"); // STOCK_IN del alta
    expect(kinds).toContain("LOAN");
    expect(kinds).toContain("RETURN");
    expect(kinds).toContain("AUDIT");

    const times = res.body.history.map((h) => new Date(h.date).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const loanEntry = res.body.history.find((h) => h.kind === "LOAN");
    expect(loanEntry?.number).toBe(loan.number);
    expect(loanEntry?.returned).toBe(true);
    expect(loanEntry?.custodian ?? loanEntry?.department).toBeTruthy();

    const returnEntry = res.body.history.find((h) => h.kind === "RETURN");
    expect(returnEntry?.number).toMatch(/^DEV-/);
    expect(returnEntry?.loanNumber).toBe(loan.number);
  });

  test("un id inexistente es 404", async ({ inv }) => {
    const res = await inv.get("/inventory/units/00000000-0000-0000-0000-000000000000/history");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UNIT_NOT_FOUND" });
  });

  test("sin token es 401", async ({ invAnonymous, inv, scenario }) => {
    const device = await scenario.device(1);
    const unit = (await inv.units(device.id))[0];
    expect((await invAnonymous.get(`/inventory/units/${unit.id}/history`)).status).toBe(401);
  });
});
