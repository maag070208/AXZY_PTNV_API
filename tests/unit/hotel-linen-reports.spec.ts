import { test, expect } from "@playwright/test";
import {
  aggregateShrinkage,
  investmentToPar,
  lineDelta,
  lotLifeEstimate,
  periodMonths,
  washRate,
  parShortfall,
  pctOf,
  periodRange,
  runningBalance,
  sumInvestments,
  towelShortage,
  transferShortage,
} from "../../src/modules/hotel-store/linen/services/report-rules";

test.describe("Reportes de blancos: reglas puras", () => {
  test("inversión al par con IVA 16 % y 8 %", () => {
    const inv = investmentToPar({ total: 60, par: 100, lastCost: 125.5 });
    expect(inv.shortfall).toBe(40);
    expect(inv.subtotal).toBe(5020);
    expect(inv.iva16).toBe(803.2);
    expect(inv.total16).toBe(5823.2);
    expect(inv.iva8).toBe(401.6);
    expect(inv.total8).toBe(5421.6);
  });

  test("sin faltante, sin par o sin costo no hay inversión", () => {
    expect(parShortfall(120, 100)).toBe(0);
    expect(parShortfall(10, 0)).toBe(0);
    const noCost = investmentToPar({ total: 0, par: 10, lastCost: null });
    expect(noCost.subtotal).toBe(0);
    expect(noCost.hasCost).toBe(false);
  });

  test("suma de inversiones", () => {
    const t = sumInvestments([{ subtotal: 100 }, { subtotal: 50.5 }]);
    expect(t.subtotal).toBe(150.5);
    expect(t.total16).toBe(174.58);
    expect(t.total8).toBe(162.54);
  });

  test("merma por fuente, producto y motivo", () => {
    expect(transferShortage(10, 7)).toBe(3);
    expect(transferShortage(10, 12)).toBe(0);
    expect(transferShortage(10, null)).toBe(0);
    expect(towelShortage(5, 2)).toBe(3);
    const agg = aggregateShrinkage([
      { source: "TRANSFER", productId: "a", quantity: 3, unitCost: 100 },
      { source: "COUNT", productId: "a", quantity: 2, unitCost: 100 },
      { source: "TOWEL", productId: "b", quantity: 4, unitCost: 50 },
      { source: "WRITEOFF", productId: "b", quantity: 1, unitCost: 50, reasonCode: "R" },
      { source: "WRITEOFF", productId: "b", quantity: 0, unitCost: 50, reasonCode: "M" },
    ]);
    expect(agg.bySource.TRANSFER).toEqual({ pieces: 3, amount: 300 });
    expect(agg.bySource.TOWEL).toEqual({ pieces: 4, amount: 200 });
    expect(agg.byReason).toEqual({ R: { pieces: 1, amount: 50 } });
    expect(agg.total).toEqual({ pieces: 10, amount: 750 });
    expect(agg.byProduct.find((p) => p.productId === "a")?.pieces).toBe(5);
  });

  test("saldo corrido del kardex", () => {
    const rows = runningBalance([{ delta: 10 }, { delta: -3 }, { delta: 5 }], 2);
    expect(rows.map((r) => r.balance)).toEqual([12, 9, 14]);
  });

  test("delta de una línea por almacén y global", () => {
    const m = (status: string, from: string | null, to: string | null) => ({ status, fromWarehouseId: from, warehouseId: to });
    const line = { quantity: 10, receivedQuantity: null };
    expect(lineDelta(line, m("ACTIVE", null, "w1"), "w1")).toBe(10);
    expect(lineDelta(line, m("ACTIVE", "w1", "w2"), "w1")).toBe(-10);
    expect(lineDelta(line, m("ACTIVE", "w1", "w2"), "w2")).toBe(10);
    expect(lineDelta(line, m("IN_TRANSIT", "w1", "w2"), "w2")).toBe(0);
    expect(lineDelta({ quantity: 10, receivedQuantity: 8 }, m("RECEIVED_WITH_DIFFERENCE", "w1", "w2"), "w2")).toBe(8);
    expect(lineDelta({ quantity: 10, receivedQuantity: 8 }, m("RECEIVED_WITH_DIFFERENCE", "w1", "w2"), null)).toBe(-2);
    expect(lineDelta(line, m("ACTIVE", "w1", "w2"), null)).toBe(0);
    expect(lineDelta(line, m("ACTIVE", "w1", null), null)).toBe(-10);
  });

  test("porcentajes y periodo", () => {
    expect(pctOf(1, 4)).toBe(25);
    expect(pctOf(1, 0)).toBeNull();
    const r = periodRange("2026-11-01", "2026-11-07");
    expect(r.from.getDate()).toBe(1);
    expect(r.to.getDate()).toBe(8);
    expect(() => periodRange("2026-11-08", "2026-11-01")).toThrow();
    expect(() => periodRange("bad", null)).toThrow();
  });
});

test.describe("Lotes y vida útil (ajuste demo v2)", () => {
  test("meses del periodo con mínimo de 0.25", () => {
    expect(periodMonths(new Date(2026, 0, 1), new Date(2026, 3, 1))).toBeCloseTo(3, 0);
    expect(periodMonths(new Date(2026, 0, 1), new Date(2026, 0, 1))).toBe(0.25);
  });

  test("lavadas por pieza al mes", () => {
    expect(washRate(120, 600, 3)).toBe(0.07);
    expect(washRate(120, 0, 3)).toBe(0);
    expect(washRate(0, 600, 3)).toBe(0);
  });

  test("vida útil usada por lote", () => {
    const life = lotLifeEstimate(new Date("2026-01-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"), 2, 100);
    expect(life.ageMonths).toBeCloseTo(5.95, 1);
    expect(life.estWashes).toBeCloseTo(11.9, 1);
    expect(life.pctLife).toBeCloseTo(0.12, 2);
    expect(lotLifeEstimate(new Date("2026-01-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"), 2, null)).toEqual({
      ageMonths: expect.any(Number),
      estWashes: null,
      pctLife: null,
    });
  });
});
