import { test, expect } from "@playwright/test";
import { kitchenLedgerSign } from "../../src/modules/kitchen/services/ledger";
import { allocateFefo, type FefoLot } from "../../src/modules/kitchen/services/fefo";
import { addDays, lotStatus, stockStatus, suggestedQuantity } from "../../src/modules/kitchen/services/stock";

/** Reglas puras del almacén de cocina: kardex, reparto FEFO y estado de stock. */

test.describe("kitchenLedgerSign", () => {
  test("entradas suman y salidas restan", () => {
    expect(kitchenLedgerSign("STOCK_IN")).toBe(1);
    expect(kitchenLedgerSign("ADJUSTMENT_IN")).toBe(1);
    expect(kitchenLedgerSign("CONSUMPTION")).toBe(-1);
    expect(kitchenLedgerSign("WASTE")).toBe(-1);
    expect(kitchenLedgerSign("ADJUSTMENT_OUT")).toBe(-1);
  });

  test("la reversión aplica lo contrario de su origen", () => {
    expect(kitchenLedgerSign("REVERSAL", "STOCK_IN")).toBe(-1);
    expect(kitchenLedgerSign("REVERSAL", "CONSUMPTION")).toBe(1);
    expect(() => kitchenLedgerSign("REVERSAL")).toThrow();
    expect(() => kitchenLedgerSign("REVERSAL", "REVERSAL")).toThrow();
  });
});

test.describe("allocateFefo", () => {
  const today = "2026-09-28";
  const lot = (id: string, expiresOn: string | null, onHand: number, received = "2026-09-01"): FefoLot => ({
    id,
    lotCode: id,
    expiresOn,
    onHand,
    receivedAt: new Date(`${received}T12:00:00Z`),
  });

  test("toma primero el que caduca antes y deja al final los que no caducan", () => {
    const r = allocateFefo([lot("sin", null, 10), lot("oct", "2026-10-10", 2), lot("sep", "2026-09-30", 1.5)], 4, today);
    expect(r.allocations.map((a) => [a.lotId, a.quantity])).toEqual([
      ["sep", 1.5],
      ["oct", 2],
      ["sin", 0.5],
    ]);
    expect(r.missing).toBe(0);
  });

  test("entre la misma caducidad, el recibido antes", () => {
    const r = allocateFefo([lot("nuevo", "2026-10-01", 5, "2026-09-20"), lot("viejo", "2026-10-01", 5, "2026-09-10")], 6, today);
    expect(r.allocations.map((a) => a.lotId)).toEqual(["viejo", "nuevo"]);
  });

  test("un consumo no toma caducados; una merma sí", () => {
    const lots = [lot("cad", "2026-09-27", 3), lot("vig", "2026-09-28", 1)];
    expect(allocateFefo(lots, 2, today)).toEqual({
      allocations: [{ lotId: "vig", lotCode: "vig", expiresOn: "2026-09-28", quantity: 1 }],
      missing: 1,
    });
    expect(allocateFefo(lots, 2, today, { includeExpired: true }).allocations[0]).toMatchObject({ lotId: "cad", quantity: 2 });
  });

  test("decimales sin error de redondeo", () => {
    const r = allocateFefo([lot("a", "2026-10-01", 0.1), lot("b", "2026-10-02", 0.2)], 0.3, today);
    expect(r.allocations.map((a) => a.quantity)).toEqual([0.1, 0.2]);
    expect(r.missing).toBe(0);
  });
});

test.describe("mínimos, máximos y caducidad", () => {
  test("estado de stock", () => {
    expect(stockStatus(1, 2, 10)).toBe("LOW");
    expect(stockStatus(2, 2, 10)).toBe("OK");
    expect(stockStatus(11, 2, 10)).toBe("OVER");
    expect(stockStatus(500, 2, null)).toBe("OK");
  });

  test("sugerido: hasta el máximo; sin máximo, al doble del mínimo; piezas completas", () => {
    expect(suggestedQuantity(1.25, 2, 10, { whole: false })).toBe(8.75);
    expect(suggestedQuantity(1, 3, null, { whole: false })).toBe(5);
    expect(suggestedQuantity(2.5, 3, 10, { whole: true })).toBe(8);
    expect(suggestedQuantity(12, 3, 10, { whole: false })).toBe(0);
  });

  test("estado del lote en el límite del día", () => {
    const today = "2026-09-28";
    expect(lotStatus(1, "2026-09-27", today, 3)).toBe("EXPIRED");
    expect(lotStatus(1, "2026-09-28", today, 3)).toBe("EXPIRING");
    expect(lotStatus(1, "2026-10-01", today, 3)).toBe("EXPIRING");
    expect(lotStatus(1, "2026-10-02", today, 3)).toBe("VALID");
    expect(lotStatus(1, null, today, 3)).toBe("VALID");
    expect(lotStatus(0, "2026-09-01", today, 3)).toBe("EMPTY");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
