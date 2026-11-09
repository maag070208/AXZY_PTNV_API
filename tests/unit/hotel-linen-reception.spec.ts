import { test, expect } from "@playwright/test";
import {
  DEFAULT_TOWEL_DEPOSIT,
  assertReturnQuantity,
  computeShiftClose,
  depositOf,
  depositSplit,
  depositsByMethod,
  parseTowelDeposit,
  statusAfterReturn,
  type ShiftLoan,
} from "../../src/modules/hotel-store/linen/services/loan-rules";
import { missingOf, splitByLots, statusAfterCollect, extraKindOf, assertCanCollect } from "../../src/modules/hotel-store/linen/services/extra-rules";
import {
  assertAvailable,
  assertManualTransition,
  assertRepairable,
  nextTags,
  statusAfterReturn as equipmentStatusAfterReturn,
} from "../../src/modules/hotel-store/linen/services/equipment-rules";
import { assertMovementShape, ledgerDeltas } from "../../src/modules/hotel-store/services/kardex-rules";

const loan = (id: string, status: ShiftLoan["status"], quantity: number, returnedQty: number, depositUnit = 100): ShiftLoan => ({
  id,
  status,
  quantity,
  returnedQty,
  depositUnit,
});

test.describe("préstamo de toallas: depósito", () => {
  test("depósito por toalla desde sys_config con valor por defecto", () => {
    expect(parseTowelDeposit("150")).toBe(150);
    expect(parseTowelDeposit(undefined)).toBe(DEFAULT_TOWEL_DEPOSIT);
    expect(parseTowelDeposit("abc")).toBe(DEFAULT_TOWEL_DEPOSIT);
    expect(parseTowelDeposit("-5")).toBe(DEFAULT_TOWEL_DEPOSIT);
  });

  test("devolución parcial: devuelto = qty × unitario y el resto queda retenido en caja", () => {
    expect(depositOf(3, 100)).toBe(300);
    expect(depositSplit({ quantity: 4, returnedQty: 3, depositUnit: 100 })).toEqual({ collected: 400, returned: 300, held: 100 });
    expect(statusAfterReturn(4, 3)).toBe("PARTIAL");
    expect(statusAfterReturn(4, 4)).toBe("RETURNED");
  });

  test("no se devuelve más de lo prestado ni cantidades inválidas", () => {
    expect(() => assertReturnQuantity(2, 3)).toThrow();
    expect(() => assertReturnQuantity(2, 0)).toThrow();
    expect(() => assertReturnQuantity(2, 2)).not.toThrow();
  });

  test("depósito en caja por método sobre lo que sigue prestado", () => {
    expect(
      depositsByMethod([
        { depositMethod: "CASH", quantity: 2, returnedQty: 0, depositUnit: 100 },
        { depositMethod: "CASH", quantity: 4, returnedQty: 3, depositUnit: 100 },
        { depositMethod: "CARD", quantity: 1, returnedQty: 0, depositUnit: 100 },
      ])
    ).toEqual({ CASH: 300, CARD: 100, ROOM_CHARGE: 0 });
  });
});

test.describe("corte de turno", () => {
  test("totaliza devueltos y marcados; cobrado = devuelto + retenido", () => {
    const plan = computeShiftClose(
      [loan("a", "RETURNED", 2, 2), loan("b", "PARTIAL", 4, 3), loan("c", "OPEN", 1, 0), loan("d", "OPEN", 3, 0)],
      ["b", "c"]
    );
    expect(plan.totals).toEqual({
      lent: 7,
      returned: 5,
      unreturned: 2,
      depositsCollected: 700,
      depositsReturned: 500,
      depositsRetained: 200,
    });
    // El abierto sin marcar pasa al turno siguiente, completo.
    expect(plan.carriedOver.map((l) => l.id)).toEqual(["d"]);
    expect(plan.totals.depositsCollected).toBe(plan.totals.depositsReturned + plan.totals.depositsRetained);
  });

  test("solo se marcan préstamos abiertos que pertenezcan al corte", () => {
    expect(() => computeShiftClose([loan("a", "RETURNED", 1, 1)], ["a"])).toThrow();
    expect(() => computeShiftClose([loan("a", "OPEN", 1, 0)], ["zzz"])).toThrow();
  });

  test("sin préstamos abiertos todo se incluye y nada se retiene", () => {
    const plan = computeShiftClose([loan("a", "RETURNED", 3, 3)], []);
    expect(plan.totals.unreturned).toBe(0);
    expect(plan.totals.depositsRetained).toBe(0);
    expect(plan.carriedOver).toHaveLength(0);
  });
});

test.describe("adicionales a habitación", () => {
  test("el tipo sale del producto: blanco o consumible, nunca equipo", () => {
    expect(extraKindOf("LINEN")).toBe("LINEN");
    expect(extraKindOf("CONSUMABLE")).toBe("CONSUMABLE");
    expect(() => extraKindOf("EQUIPMENT")).toThrow();
  });

  test("faltante y estado de la recolección", () => {
    expect(missingOf(3, 3)).toBe(0);
    expect(missingOf(3, 1)).toBe(2);
    expect(() => missingOf(3, 4)).toThrow();
    expect(statusAfterCollect(0)).toBe("COLLECTED");
    expect(statusAfterCollect(2)).toBe("MISSING");
  });

  test("los consumibles no se recolectan y solo lo entregado se recolecta", () => {
    expect(() => assertCanCollect("DELIVERED", "CONSUMABLE")).toThrow();
    expect(() => assertCanCollect("REQUESTED", "LINEN")).toThrow();
    expect(() => assertCanCollect("DELIVERED", "LINEN")).not.toThrow();
  });

  test("lo recolectado se reparte entre los lotes de salida en orden", () => {
    expect(splitByLots([{ lotId: "L1", quantity: 2 }, { lotId: "L2", quantity: 3 }], 3)).toEqual([
      { lotId: "L1", quantity: 2 },
      { lotId: "L2", quantity: 1 },
    ]);
    expect(splitByLots([{ lotId: "L1", quantity: 2 }], 0)).toEqual([]);
  });

  test("ROOM_EXTRA solo saca y EXTRA_RETURN solo mete", () => {
    expect(ledgerDeltas("ROOM_EXTRA")).toEqual({ source: -1, target: 0 });
    expect(ledgerDeltas("EXTRA_RETURN")).toEqual({ source: 0, target: 1 });
    expect(() => assertMovementShape("EXTRA_RETURN", { warehouseId: "w", lines: [{ quantity: 1 }] })).not.toThrow();
    // Préstamos dentro del mismo punto (GENERAL -> LENT) sí son válidos.
    expect(() => assertMovementShape("LOAN_OUT", { fromWarehouseId: "p", warehouseId: "p", lines: [{ quantity: 1 }] })).not.toThrow();
  });
});

test.describe("equipos por pieza", () => {
  test("etiquetas consecutivas por prefijo, sin reutilizar huecos", () => {
    expect(nextTags("SEC", [], 2)).toEqual(["SEC-001", "SEC-002"]);
    expect(nextTags("SEC", ["SEC-001", "SEC-004", "PLA-009"], 2)).toEqual(["SEC-005", "SEC-006"]);
    expect(nextTags("S.C", ["SXC-007"], 1)).toEqual(["S.C-001"]);
  });

  test("transiciones de la devolución: B disponible, D reparación, F extraviada", () => {
    expect(equipmentStatusAfterReturn("GOOD")).toBe("AVAILABLE");
    expect(equipmentStatusAfterReturn("DAMAGED")).toBe("IN_REPAIR");
    expect(equipmentStatusAfterReturn("MISSING")).toBe("MISSING");
  });

  test("solo una pieza disponible se presta y solo una en reparación se repara", () => {
    expect(() => assertAvailable("AVAILABLE")).not.toThrow();
    expect(() => assertAvailable("LOANED")).toThrow();
    expect(() => assertRepairable("IN_REPAIR")).not.toThrow();
    expect(() => assertRepairable("AVAILABLE")).toThrow();
  });

  test("cambios manuales: retirar y reactivar; nunca una pieza prestada", () => {
    expect(() => assertManualTransition("AVAILABLE", "RETIRED")).not.toThrow();
    expect(() => assertManualTransition("RETIRED", "AVAILABLE")).not.toThrow();
    expect(() => assertManualTransition("MISSING", "AVAILABLE")).not.toThrow();
    expect(() => assertManualTransition("LOANED", "RETIRED")).toThrow();
    expect(() => assertManualTransition("AVAILABLE", "AVAILABLE")).toThrow();
  });
});
