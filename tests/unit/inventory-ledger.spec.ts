import { test, expect } from "@playwright/test";
import { ledgerDelta } from "../../src/modules/inventory/services/ledger";

/**
 * Regla del kardex: la suma de `ledgerDelta` de los movimientos de un
 * dispositivo debe dar sus unidades DISPONIBLES. Cada escenario reproduce lo
 * que hace la API con las unidades y comprueba que el saldo termina igual.
 */
test.describe("kardex = existencia disponible", () => {
  test("alta, préstamo y devolución en buen estado", () => {
    const balance = ledgerDelta("STOCK_IN", 5, null) + ledgerDelta("LOAN", 3, null) + ledgerDelta("RETURN", 3, "GOOD");
    expect(balance).toBe(5);
  });

  test("devolución dañada: la unidad queda DAÑADA, no disponible", () => {
    const balance = ledgerDelta("STOCK_IN", 5, null) + ledgerDelta("LOAN", 2, null) + ledgerDelta("RETURN", 2, "POOR");
    expect(balance).toBe(3);
  });

  test("devolución rota: entra y la baja automática la saca", () => {
    const balance =
      ledgerDelta("STOCK_IN", 5, null) +
      ledgerDelta("LOAN", 1, null) +
      ledgerDelta("RETURN", 1, "BROKEN") +
      ledgerDelta("RETIREMENT", 1, "BROKEN");
    expect(balance).toBe(4);
  });

  test("baja de una unidad disponible resta; de una dañada no", () => {
    expect(ledgerDelta("RETIREMENT", 1, null)).toBe(-1);
    expect(ledgerDelta("ADJUSTMENT_OUT", 2, null)).toBe(-2);
    expect(ledgerDelta("RETIREMENT", 1, "POOR")).toBe(0);
  });

  test("traspaso no cambia la existencia", () => {
    expect(ledgerDelta("TRANSFER", 4, null)).toBe(0);
  });

  test("cancelar un préstamo: la reversión regresa lo pendiente", () => {
    // Préstamo de 3, devuelve 1 y se cancela con 2 pendientes.
    const balance =
      ledgerDelta("STOCK_IN", 3, null) +
      ledgerDelta("LOAN", 3, null) +
      ledgerDelta("RETURN", 1, "GOOD") +
      ledgerDelta("REVERSAL", 2, null, "LOAN");
    expect(balance).toBe(3);
  });

  test("reversiones de mantenimiento", () => {
    // Entra a mantenimiento y se revierte: vuelve a disponible.
    expect(ledgerDelta("MAINTENANCE_IN", 2, null) + ledgerDelta("REVERSAL", 2, null, "MAINTENANCE_IN")).toBe(0);
    // Sale bien de mantenimiento y se revierte: regresa a mantenimiento.
    expect(ledgerDelta("MAINTENANCE_OUT", 1, "GOOD") + ledgerDelta("REVERSAL", 1, "GOOD", "MAINTENANCE_OUT")).toBe(0);
    // Salió dañada (no disponible): revertirla tampoco cambia disponibles.
    expect(ledgerDelta("REVERSAL", 1, "POOR", "MAINTENANCE_OUT")).toBe(0);
  });

  test("una reversión sin origen conocido no mueve la existencia", () => {
    expect(ledgerDelta("REVERSAL", 3, null, null)).toBe(0);
  });

  test("ajustes de alta y baja suman y restan disponibles", () => {
    const balance =
      ledgerDelta("STOCK_IN", 5, null) +
      ledgerDelta("ADJUSTMENT_IN", 2, null) +
      ledgerDelta("ADJUSTMENT_OUT", 3, null);
    expect(balance).toBe(4);
  });

  test("reversiones de ajustes", () => {
    // Revertir un alta resta lo que sumó; revertir una baja lo devuelve.
    expect(
      ledgerDelta("ADJUSTMENT_IN", 2, null) + ledgerDelta("REVERSAL", 2, null, "ADJUSTMENT_IN")
    ).toBe(0);
    expect(
      ledgerDelta("ADJUSTMENT_OUT", 3, null) + ledgerDelta("REVERSAL", 3, null, "ADJUSTMENT_OUT")
    ).toBe(0);
    // Baja de una dañada (POOR) no restó; revertirla tampoco suma.
    expect(ledgerDelta("REVERSAL", 2, "POOR", "ADJUSTMENT_OUT")).toBe(0);
  });
});
