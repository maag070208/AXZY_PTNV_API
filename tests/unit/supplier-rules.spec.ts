import { test, expect } from "@playwright/test";
import { isValidRfc, normalizeRfc, toBaseUnits, withPrimary } from "../../src/modules/kitchen/services/supplier-rules";

/** Reglas puras de proveedores: RFC, unidad de compra y contacto principal. */

test.describe("RFC", () => {
  test("normaliza mayúsculas y espacios; vacío es null", () => {
    expect(normalizeRfc(" abc 010101 ab1 ")).toBe("ABC010101AB1");
    expect(normalizeRfc("   ")).toBeNull();
    expect(normalizeRfc(null)).toBeNull();
  });

  test("acepta persona moral (3 letras) y física (4), con Ñ y &", () => {
    expect(isValidRfc("ABC010101AB1")).toBe(true);
    expect(isValidRfc("PEJU800215H45")).toBe(true);
    expect(isValidRfc("ÑA&010101AB1")).toBe(true);
  });

  test("rechaza formato o fecha inválidos", () => {
    expect(isValidRfc("AB010101AB1")).toBe(false);
    expect(isValidRfc("ABC011301AB1")).toBe(false);
    expect(isValidRfc("ABC010132AB1")).toBe(false);
    expect(isValidRfc("ABC010101AB")).toBe(false);
  });
});

test.describe("unidad de compra → unidad base", () => {
  test("3 cajas de 12 a $120 la caja = 36 piezas a $10", () => {
    expect(toBaseUnits(3, 120, 12)).toEqual({ quantity: 36, unitCost: 10 });
  });

  test("bulto de 25 kg con decimales y sin costo", () => {
    expect(toBaseUnits(1.5, null, 25)).toEqual({ quantity: 37.5, unitCost: null });
    expect(toBaseUnits(2, 100, 3)).toEqual({ quantity: 6, unitCost: 33.3333 });
  });
});

test.describe("contacto principal", () => {
  test("sin principal, el primero lo es; con uno, se respeta", () => {
    expect(withPrimary([{ isPrimary: false }, { isPrimary: false }])!.map((c) => c.isPrimary)).toEqual([true, false]);
    expect(withPrimary([{}, { isPrimary: true }])!.map((c) => c.isPrimary)).toEqual([false, true]);
    expect(withPrimary([])).toEqual([]);
  });

  test("más de uno principal es inválido", () => {
    expect(withPrimary([{ isPrimary: true }, { isPrimary: true }])).toBeNull();
  });
});
