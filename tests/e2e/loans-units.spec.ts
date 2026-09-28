import { test, expect } from "./support/fixtures";
import { db } from "./support/db";

/**
 * PRÉSTAMOS POR UNIDAD EXACTA — DISPOSITIVOS.md §8 a §14, BLINDAJE.md §1, §7.
 *
 * La web siempre manda las piezas físicas (`unitIds`); aquí se cubre que la
 * API ligue exactamente esas unidades al préstamo, a la edición y a la
 * devolución, y que la cancelación parcial revierta solo lo pendiente.
 */
test.describe("PRÉSTAMOS por unidad exacta", () => {
  test("presta exactamente las unidades indicadas", async ({ inv, scenario, departmentId }) => {
    const device = await scenario.device(6);
    const units = await inv.units(device.id);
    const chosen = [units[1], units[3]];

    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: chosen.map((u) => u.id) }],
    });

    expect(loan.items[0]).toMatchObject({ quantity: 2, returnedQuantity: 0 });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 4, ON_LOAN: 2 });

    const after = await inv.units(device.id);
    expect(
      after.filter((u) => u.status === "ON_LOAN").map((u) => u.id).sort()
    ).toEqual(chosen.map((u) => u.id).sort());

    const linked = await db.loanItemUnit.findMany({
      where: { loanItemId: loan.items[0].id },
      select: { deviceUnitId: true },
    });
    expect(linked.map((l) => l.deviceUnitId).sort()).toEqual(chosen.map((u) => u.id).sort());
  });

  test("editar el préstamo reemplaza las unidades por las nuevas", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(6);
    const units = await inv.units(device.id);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: [units[0].id, units[1].id] }],
    });

    const edited = await inv.updateLoan(loan.id, {
      unitIds: [units[2].id, units[3].id, units[4].id],
    });

    expect(edited.items[0].quantity).toBe(3);
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, ON_LOAN: 3 });
    const after = await inv.units(device.id);
    expect(
      after.filter((u) => u.status === "ON_LOAN").map((u) => u.id).sort()
    ).toEqual([units[2].id, units[3].id, units[4].id].sort());
    // Las liberadas vuelven a disponibles.
    expect(after.find((u) => u.id === units[0].id)?.status).toBe("AVAILABLE");
  });

  test("la devolución parcial por unidades devuelve solo las indicadas", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(6);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 4 }],
    });
    const loanItemId = loan.items[0].id;
    const pending = await db.loanItemUnit.findMany({
      where: { loanItemId, returned: false },
      orderBy: { deviceUnit: { assetTag: "asc" } },
      select: { id: true, deviceUnitId: true },
    });
    const returning = pending.slice(0, 2);

    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId, unitIds: returning.map((p) => p.deviceUnitId), condition: "GOOD" }],
    });

    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 4, ON_LOAN: 2 });
    expect((await inv.loan(loan.id)).status).toBe("PARTIAL");

    const closed = await db.loanItemUnit.findMany({
      where: { id: { in: returning.map((p) => p.id) } },
      select: { returned: true },
    });
    expect(closed.every((c) => c.returned)).toBe(true);
    // Las que no se devolvieron siguen pendientes.
    expect(
      await db.loanItemUnit.count({ where: { loanItemId, returned: false } })
    ).toBe(2);
  });

  test("la cancelación parcial revierte solo las piezas pendientes y el kardex queda en disponibles", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(6);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 4 }],
    });
    const loanItemId = loan.items[0].id;
    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId, quantity: 1, condition: "GOOD" }],
    });

    const cancelled = await inv.cancelLoan(loan.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 6, ON_LOAN: 0 });

    const reversals = await inv.listMovements({ deviceId: device.id, type: "REVERSAL" });
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ reversalOfId: loan.movementId });
    expect(reversals[0].items[0].quantity).toBe(3);

    // Kardex = unidades disponibles (la REVERSAL devolvió lo pendiente).
    const ledger = await inv.stockLedger(device.id);
    expect(ledger.rows.at(-1)!.balance).toBe(ledger.stock.AVAILABLE);
    expect(ledger.stock.AVAILABLE).toBe(6);
  });

  test("la devolución POOR no suma disponibilidad y el kardex sigue cuadrado", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(6);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 3 }],
    });

    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId: loan.items[0].id, quantity: 1, condition: "POOR" }],
    });

    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 3,
      ON_LOAN: 2,
      DAMAGED: 1,
      active: 6,
    });
    const ledger = await inv.stockLedger(device.id);
    expect(ledger.rows.at(-1)!.balance).toBe(ledger.stock.AVAILABLE);
    expect(ledger.stock.AVAILABLE).toBe(3);
  });

  test("la baja de una unidad dañada no resta disponibilidad", async ({
    ctxAdmin,
    inv,
    scenario,
    departmentId,
  }) => {
    // Deja una unidad DAÑADA: prestar, devolver POOR.
    const device = await scenario.device(4);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 1 }],
    });
    const loanItemId = loan.items[0].id;
    const pending = await db.loanItemUnit.findFirstOrThrow({
      where: { loanItemId, returned: false },
      select: { deviceUnitId: true },
    });
    await inv.returnLoan({
      loanId: loan.id,
      items: [{ loanItemId, quantity: 1, condition: "POOR" }],
    });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, DAMAGED: 1 });

    // La salida de material da de baja la unidad dañada (RETIREMENT con POOR):
    // no resta disponibles porque ya no contaba.
    const res = await ctxAdmin.post("material-outputs", {
      data: {
        description: `E2E baja dañada ${device.name}`,
        departmentName: "E2E Depto baja",
        userName: "E2E Usuario baja",
        reason: "DAMAGED",
        deviceUnitId: pending.deviceUnitId,
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 3,
      DAMAGED: 0,
      RETIRED: 1,
      active: 3,
      historical: 4,
    });
    const ledger = await inv.stockLedger(device.id);
    expect(ledger.rows.at(-1)!.balance).toBe(ledger.stock.AVAILABLE);
  });

  test("rechaza devolver una unidad que no está pendiente en el préstamo", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(4);
    const units = await inv.units(device.id);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: [units[0].id] }],
    });

    const res = await inv.post("/inventory/returns", {
      loanId: loan.id,
      items: [{ loanItemId: loan.items[0].id, unitIds: [units[1].id], condition: "GOOD" }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: expect.stringContaining(units[1].assetTag),
    });
    expect(await inv.stock(device.id)).toMatchObject({ ON_LOAN: 1, AVAILABLE: 3 });
  });

  test("las unidades prestadas no se pueden dar de baja por mantenimiento", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(3);
    const units = await inv.units(device.id);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, unitIds: [units[0].id] }],
    });
    expect(loan.status).toBe("ACTIVE");

    const res = await inv.post("/inventory/movements", {
      type: "MAINTENANCE_IN",
      items: [{ deviceId: device.id, unitId: units[0].id }],
    });
    expect(res.status).toBe(409);
  });

  test.describe("validaciones del DTO de préstamo", () => {
    test("rechaza unidades repetidas (DUPLICATE_UNITS)", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(2);
      const units = await inv.units(device.id);

      const res = await inv.post("/inventory/loans", {
        departmentId,
        items: [{ deviceId: device.id, unitIds: [units[0].id, units[0].id] }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
      expect(JSON.stringify(res.body)).toContain("Una unidad viene repetida");
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 2, ON_LOAN: 0 });
    });

    test("rechaza cantidad que no coincide con las unidades (QUANTITY_UNITS_MISMATCH)", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(3);
      const units = await inv.units(device.id);

      const res = await inv.post("/inventory/loans", {
        departmentId,
        items: [{ deviceId: device.id, quantity: 3, unitIds: [units[0].id, units[1].id] }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
      expect(JSON.stringify(res.body)).toContain("La cantidad no coincide con las unidades seleccionadas");
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, ON_LOAN: 0 });
    });

    test("rechaza un renglón sin cantidad ni unidades (QUANTITY_OR_UNITS_REQUIRED)", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(1);

      const res = await inv.post("/inventory/loans", {
        departmentId,
        items: [{ deviceId: device.id }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
      expect(JSON.stringify(res.body)).toContain("Indica la cantidad o las unidades");
    });
  });
});
