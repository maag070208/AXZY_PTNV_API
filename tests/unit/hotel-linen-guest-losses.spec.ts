import { test, expect } from "@playwright/test";
import {
  aggregateGuestLosses,
  assertExtraConvertible,
  assertLoanConvertible,
  assertNotConverted,
  normalizeGuestName,
  pickWriteoffToReclassify,
  resolveCharge,
  suggestedChargeAmount,
  unreturnedQty,
} from "../../src/modules/hotel-store/linen/services/guest-loss-rules";
import { photosRequired, reasonRequiresHold } from "../../src/modules/hotel-store/linen/services/writeoff-rules";

test.describe("pérdidas por huésped", () => {
  test("motivo G no retiene pieza ni exige foto", () => {
    expect(reasonRequiresHold("G")).toBe(false);
    expect(reasonRequiresHold("R")).toBe(true);
    expect(photosRequired(["G"])).toBe(false);
    expect(photosRequired(["G", "F"])).toBe(false);
    expect(photosRequired(["G", "R"])).toBe(true);
  });

  test("cobro sugerido y resolución", () => {
    expect(suggestedChargeAmount([{ quantity: 2, unitCost: 150.5 }, { quantity: 1, unitCost: null }])).toBe(301);
    expect(resolveCharge(undefined, undefined, 301)).toEqual({ chargeStatus: "NOT_CHARGED", chargeAmount: null });
    expect(resolveCharge("WAIVED", null, 301)).toEqual({ chargeStatus: "WAIVED", chargeAmount: null });
    expect(resolveCharge("PENDING", undefined, 301)).toEqual({ chargeStatus: "PENDING", chargeAmount: 301 });
    expect(resolveCharge("CHARGED", 250, 301)).toEqual({ chargeStatus: "CHARGED", chargeAmount: 250 });
    expect(resolveCharge("NOT_CHARGED", 120, 301).chargeAmount).toBe(120);
    expect(() => resolveCharge("PENDING", 0, 301)).toThrow();
    expect(() => resolveCharge("PENDING", undefined, 0)).toThrow();
    expect(() => resolveCharge("NOT_CHARGED", -1, 301)).toThrow();
  });

  test("nombre de huésped obligatorio", () => {
    expect(normalizeGuestName("  Ana   Pérez ")).toBe("Ana Pérez");
    expect(() => normalizeGuestName("   ")).toThrow();
    expect(() => normalizeGuestName(null)).toThrow();
  });

  test("conversión: solo UNRETURNED / MISSING y una sola vez", () => {
    expect(unreturnedQty(5, 2)).toBe(3);
    expect(() => assertLoanConvertible("UNRETURNED", 3)).not.toThrow();
    expect(() => assertLoanConvertible("OPEN", 3)).toThrow();
    expect(() => assertLoanConvertible("UNRETURNED", 0)).toThrow();
    expect(() => assertExtraConvertible("MISSING", 1)).not.toThrow();
    expect(() => assertExtraConvertible("COLLECTED", 1)).toThrow();
    expect(() => assertExtraConvertible("MISSING", 0)).toThrow();
    expect(() => assertNotConverted(null)).not.toThrow();
    expect(() => assertNotConverted("CANCELLED")).not.toThrow();
    expect(() => assertNotConverted("PENDING_APPROVAL")).toThrow();
    expect(() => assertNotConverted("ACTIVE")).toThrow();
  });

  test("reclasifica la baja F existente en vez de duplicar", () => {
    const c = [
      { id: "a", status: "CANCELLED", guestName: null, notes: "Toallas no devueltas VT-0001 (corte C-1)" },
      { id: "b", status: "PENDING_APPROVAL", guestName: null, notes: "Toallas no devueltas VT-0002 (corte C-1)" },
      { id: "c", status: "ACTIVE", guestName: "Ya", notes: "Toallas no devueltas VT-0003" },
    ];
    expect(pickWriteoffToReclassify(c, "VT-0002")?.id).toBe("b");
    expect(pickWriteoffToReclassify(c, "VT-0001")).toBeNull();
    expect(pickWriteoffToReclassify(c, "VT-0003")).toBeNull();
    expect(pickWriteoffToReclassify(c)?.id).toBe("b");
  });

  test("totales: las rechazadas no suman y se separan por cobro", () => {
    const r = aggregateGuestLosses([
      { status: "ACTIVE", chargeStatus: "NOT_CHARGED", pieces: 2, cost: 300, chargeAmount: null },
      { status: "PENDING_APPROVAL", chargeStatus: "PENDING", pieces: 1, cost: 100.5, chargeAmount: 100.5 },
      { status: "CANCELLED", chargeStatus: "PENDING", pieces: 9, cost: 999, chargeAmount: 999 },
    ]);
    expect(r.total).toEqual({ events: 2, pieces: 3, cost: 400.5, chargeAmount: 100.5 });
    expect(r.byChargeStatus.find((s) => s.status === "PENDING")).toMatchObject({ events: 1, pieces: 1, chargeAmount: 100.5 });
    expect(r.byChargeStatus.find((s) => s.status === "CHARGED")?.events).toBe(0);
  });
});
