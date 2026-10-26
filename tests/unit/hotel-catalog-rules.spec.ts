import { test, expect } from "@playwright/test";
import {
  assertKittable,
  assertStockThresholds,
  assertWholeQuantity,
  normalizeEveryNDays,
  resolveKitLines,
  type KitLineRule,
} from "../../src/modules/hotel-store/services/hotel-catalog-rules";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string; status?: number }).code ?? "UNKNOWN";
  }
};

test.describe("M2-U01 umbrales de stock", () => {
  test("mínimo ≤ ideal y, con sobrestock, ideal ≤ sobrestock", () => {
    expect(codeOf(() => assertStockThresholds({ minStock: 40, idealStock: 80, overstock: 0 }))).toBeNull();
    expect(codeOf(() => assertStockThresholds({ minStock: 40, idealStock: 80, overstock: 120 }))).toBeNull();
    expect(codeOf(() => assertStockThresholds({ minStock: 90, idealStock: 80, overstock: 0 }))).toBe(
      "HOTEL_PRODUCT_THRESHOLDS_INVALID"
    );
    expect(codeOf(() => assertStockThresholds({ minStock: 10, idealStock: 80, overstock: 60 }))).toBe(
      "HOTEL_PRODUCT_THRESHOLDS_INVALID"
    );
  });
});

test.describe("M2-U02 cantidades enteras", () => {
  test("unidad entera rechaza fracciones; fraccionaria las admite", () => {
    expect(codeOf(() => assertWholeQuantity(2, true))).toBeNull();
    expect(codeOf(() => assertWholeQuantity(1.5, true))).toBe("HOTEL_QUANTITY_NOT_WHOLE");
    expect(codeOf(() => assertWholeQuantity(1.5, false))).toBeNull();
  });
});

test.describe("M2-U04 everyNDays", () => {
  test("obligatorio ≥ 1 solo con CADA_N_DIAS; en las demás queda nulo", () => {
    expect(normalizeEveryNDays("CADA_N_DIAS", 3)).toBe(3);
    expect(codeOf(() => normalizeEveryNDays("CADA_N_DIAS", null))).toBe("HOTEL_KIT_EVERY_N_DAYS_REQUIRED");
    expect(codeOf(() => normalizeEveryNDays("CADA_N_DIAS", 0))).toBe("HOTEL_KIT_EVERY_N_DAYS_REQUIRED");
    expect(normalizeEveryNDays("CADA_LIMPIEZA", 5)).toBeNull();
    expect(normalizeEveryNDays("SOLO_CHECKOUT", null)).toBeNull();
  });

  test("EQUIPO no entra a kits", () => {
    expect(codeOf(() => assertKittable("CONSUMIBLE"))).toBeNull();
    expect(codeOf(() => assertKittable("EQUIPO"))).toBe("HOTEL_PRODUCT_NOT_KITABLE");
  });
});

test.describe("M2-U03 resolveKitLines por tipo de limpieza", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const lines: KitLineRule[] = [
    { productId: "jabon", quantity: 1, frequency: "CADA_LIMPIEZA", everyNDays: null },
    { productId: "sabana", quantity: 2, frequency: "SOLO_CHECKOUT", everyNDays: null },
    { productId: "toalla", quantity: 2, frequency: "CADA_N_DIAS", everyNDays: 3 },
  ];
  const ids = (list: KitLineRule[]) => list.map((l) => l.productId);
  const none = new Map<string, Date>();

  test("check-out aplica todo menos repaso, y CADA_N_DIAS siempre", () => {
    expect(ids(resolveKitLines(lines, "CHECKOUT", none, now))).toEqual(["jabon", "sabana", "toalla"]);
  });

  test("estancia: sin SOLO_CHECKOUT; CADA_N_DIAS solo si ya pasaron N días o nunca", () => {
    expect(ids(resolveKitLines(lines, "ESTANCIA", none, now))).toEqual(["jabon", "toalla"]);
    expect(ids(resolveKitLines(lines, "ESTANCIA", new Map([["toalla", daysAgo(2)]]), now))).toEqual(["jabon"]);
    expect(ids(resolveKitLines(lines, "ESTANCIA", new Map([["toalla", daysAgo(3)]]), now))).toEqual(["jabon", "toalla"]);
  });

  test("repaso no lleva líneas", () => {
    expect(resolveKitLines(lines, "REPASO", none, now)).toEqual([]);
  });
});
