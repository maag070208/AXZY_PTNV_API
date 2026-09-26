import { test, expect } from "./support/fixtures";
import { statusesInDb } from "./support/db";
import type { Stock, InventoryApi } from "./support/inventory-api";

/**
 * Ciclo de vida completo — DISPOSITIVOS.md §26 y §28.
 *
 * Recorre ALTA → PRÉSTAMO → DEVOLUCIÓN → MANTENIMIENTO → BAJA sobre los mismos
 * dispositivos y verifica en cada paso la regla de consistencia:
 *
 *     activa    = DISPONIBLE + PRESTADO + DANADO + MANTENIMIENTO
 *     histórica = activa + BAJA
 *
 * y que lo que reporta la API coincide con lo que hay en la base.
 */
const verifyConsistency = async (
  inv: InventoryApi,
  deviceId: string,
  expected: Partial<Stock>
): Promise<Stock> => {
  const ex = await inv.stock(deviceId);

  expect(ex).toMatchObject(expected);
  expect(ex.active).toBe(ex.AVAILABLE + ex.ON_LOAN + ex.DAMAGED + ex.IN_MAINTENANCE);
  expect(ex.historical).toBe(ex.active + ex.RETIREMENT);

  // Contraste contra la base: la API no puede estar reportando algo que no existe.
  const inDb = await statusesInDb(deviceId);
  for (const status of ["AVAILABLE", "ON_LOAN", "DAMAGED", "IN_MAINTENANCE", "RETIREMENT"] as const) {
    expect(inDb[status] ?? 0).toBe(ex[status]);
  }
  return ex;
};

test.describe("Ciclo de vida completo del inventario", () => {
  test("alta → préstamo → devolución → mantenimiento → baja", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    let samsungId = "";
    let ipadId = "";
    let loanId = "";
    let itemSamsungId = "";
    let itemIpadId = "";

    await test.step("1. Alta: Samsung A9 → 15 y iPad Pro → 50", async () => {
      const samsung = await scenario.device(15, { name: `Samsung A9 ${scenario.type.code}` });
      const ipad = await scenario.device(50, { name: `iPad Pro ${scenario.type.code}` });
      samsungId = samsung.id;
      ipadId = ipad.id;

      await verifyConsistency(inv, samsungId, { AVAILABLE: 15, active: 15, historical: 15 });
      await verifyConsistency(inv, ipadId, { AVAILABLE: 50, active: 50, historical: 50 });
    });

    await test.step("2. Préstamo: Samsung 10 e iPad 5 en un solo movimiento", async () => {
      const { loan } = await inv.lend({
        departmentId,
        notes: "Entrega para proyecto X",
        items: [
          { deviceId: samsungId, quantity: 10 },
          { deviceId: ipadId, quantity: 5 },
        ],
      });
      loanId = loan.id;
      itemSamsungId = loan.items.find((d) => d.deviceId === samsungId)!.id;
      itemIpadId = loan.items.find((d) => d.deviceId === ipadId)!.id;

      expect(loan.status).toBe("ACTIVE");
      await verifyConsistency(inv, samsungId, { AVAILABLE: 5, ON_LOAN: 10, active: 15 });
      await verifyConsistency(inv, ipadId, { AVAILABLE: 45, ON_LOAN: 5, active: 50 });
    });

    await test.step("3. Devolución parcial: Samsung 4 e iPad 2 en buen estado", async () => {
      await inv.returnLoan({
        loanId,
        items: [
          { loanItemId: itemSamsungId, quantity: 4, condition: "GOOD" },
          { loanItemId: itemIpadId, quantity: 2, condition: "GOOD" },
        ],
      });

      const loan = await inv.loan(loanId);
      expect(loan.status).toBe("PARTIAL");
      await verifyConsistency(inv, samsungId, { AVAILABLE: 9, ON_LOAN: 6, active: 15 });
      await verifyConsistency(inv, ipadId, { AVAILABLE: 47, ON_LOAN: 3, active: 50 });
    });

    await test.step("4. Devolución del resto: 1 Samsung vuelve ROTO y se da de baja sola", async () => {
      await inv.returnLoan({
        loanId,
        items: [
          { loanItemId: itemSamsungId, quantity: 5, condition: "GOOD" },
          { loanItemId: itemSamsungId, quantity: 1, condition: "BROKEN" },
          { loanItemId: itemIpadId, quantity: 3, condition: "GOOD" },
        ],
      });

      const loan = await inv.loan(loanId);
      expect(loan.status).toBe("RETURNED");
      expect(loan.items.every((d) => d.returnedQuantity === d.quantity)).toBe(true);

      await verifyConsistency(inv, samsungId, {
        AVAILABLE: 14,
        ON_LOAN: 0,
        RETIREMENT: 1,
        active: 14,
        historical: 15,
      });
      await verifyConsistency(inv, ipadId, { AVAILABLE: 50, ON_LOAN: 0, active: 50 });
    });

    await test.step("5. Mantenimiento: 3 Samsung al taller, 2 vuelven bien y 1 dañada", async () => {
      await inv.sendToMaintenance(samsungId, 3, "Revisión de batería");
      await verifyConsistency(inv, samsungId, {
        AVAILABLE: 11,
        IN_MAINTENANCE: 3,
        active: 14,
      });

      await inv.removeFromMaintenance(samsungId, 2, "GOOD");
      await inv.removeFromMaintenance(samsungId, 1, "POOR");
      await verifyConsistency(inv, samsungId, {
        AVAILABLE: 13,
        IN_MAINTENANCE: 0,
        DAMAGED: 1,
        active: 14,
        historical: 15,
      });
    });

    await test.step("6. Baja: 2 Samsung por daño irreparable", async () => {
      await inv.retire(samsungId, 2, "Daño irreparable");

      await verifyConsistency(inv, samsungId, {
        AVAILABLE: 11,
        ON_LOAN: 0,
        DAMAGED: 1,
        IN_MAINTENANCE: 0,
        RETIREMENT: 3,
        active: 12,
        historical: 15,
      });
    });

    await test.step("7. El kardex cuenta la historia completa y cuadra con las existencias", async () => {
      const stockLedger = await inv.stockLedger(samsungId);

      expect(stockLedger.rows.map((r) => r.type)).toEqual([
        "STOCK_IN",
        "LOAN",
        "RETURN",
        "RETURN",
        "RETURN",
        "RETIREMENT",
        "MAINTENANCE_IN",
        "MAINTENANCE_OUT",
        "MAINTENANCE_OUT",
        "RETIREMENT",
      ]);

      // El saldo del kardex es el inventario que sigue en circulación:
      // lo activo menos lo que está dañado y fuera de uso no se descuenta aquí,
      // pero sí todas las salidas registradas.
      const last = stockLedger.rows[stockLedger.rows.length - 1];
      expect(last.balance).toBe(
        stockLedger.rows.reduce((acc, r) => acc + r.stockIn - r.stockOut, 0)
      );
      expect(stockLedger.stock).toMatchObject({ RETIREMENT: 3, active: 12, historical: 15 });
    });

    await test.step("8. Nada del histórico se borró", async () => {
      const movements = await inv.listMovements({ deviceId: samsungId });

      // 9 movimientos y 10 renglones de kardex: la devolución del paso 4 llevó
      // dos líneas (5 BUENO + 1 ROTO) dentro de un mismo movimiento.
      expect(movements).toHaveLength(9);
      expect((await inv.stockLedger(samsungId)).rows).toHaveLength(10);

      // Ningún movimiento fue eliminado; sólo se cancelan por reversión (§24).
      expect(movements.every((m) => m.status === "ACTIVE")).toBe(true);
    });
  });

  test("la existencia histórica nunca baja, pase lo que pase con la activa", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(12);
    const historical = 12;

    const steps: (() => Promise<unknown>)[] = [
      () => inv.lend({ departmentId, items: [{ deviceId: device.id, quantity: 4 }] }),
      () => inv.sendToMaintenance(device.id, 3, "Revisión"),
      () => inv.removeFromMaintenance(device.id, 3, "POOR"),
      () => inv.retire(device.id, 2, "Obsoletas"),
    ];

    for (const step of steps) {
      await step();
      const ex = await verifyConsistency(inv, device.id, {});
      expect(ex.historical).toBe(historical);
    }

    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 3,
      ON_LOAN: 4,
      DAMAGED: 3,
      IN_MAINTENANCE: 0,
      RETIREMENT: 2,
      active: 10,
      historical: 12,
    });
  });
});
