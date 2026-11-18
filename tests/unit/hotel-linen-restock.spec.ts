import { test, expect } from "@playwright/test";
import { expectedForRoom } from "../../src/modules/hotel-store/linen/services/room-par-rules";
import { parseRestockFactor, restockLine, sumExpected } from "../../src/modules/hotel-store/linen/services/restock-rules";
import { buildFlowRows, classifyLocation, flowMismatches } from "../../src/modules/hotel-store/linen/services/flow-rules";
import { HotelLinenFlowService } from "../../src/modules/hotel-store/linen/services/flow.service";

test.describe("reposición", () => {
  test("factor: default 1, enteros 1-5, el resto inválido", () => {
    expect(parseRestockFactor(undefined)).toBe(1);
    expect(parseRestockFactor("3")).toBe(3);
    for (const bad of [0, 6, 1.5, "x", -1]) expect(parseRestockFactor(bad)).toBeNull();
  });

  test("déficit = objetivo (esperado x factor) - (tiene + en camino), nunca negativo", () => {
    const pars = [{ component: "BATHROOM", productId: "towel", quantity: 2 }];
    const rooms = [{ kingBeds: 1, queenBeds: 0, sofaBeds: 0, bathrooms: 2 }, { kingBeds: 0, queenBeds: 1, sofaBeds: 0, bathrooms: 1 }];
    const expected = sumExpected(rooms.map((r) => expectedForRoom(r, pars)));
    expect(expected.get("towel")).toBe(6);
    expect(restockLine({ expected: 6, factor: 2, onHand: 5, incoming: 3 })).toEqual({ target: 12, onHand: 5, incoming: 3, deficit: 4 });
    expect(restockLine({ expected: 6, factor: 1, onHand: 10, incoming: 0 }).deficit).toBe(0);
  });
});

test.describe("flujo", () => {
  test("clasificación de ubicaciones en etapas", () => {
    expect(classifyLocation("ZONE", "GENERAL")).toBe("AREAS");
    expect(classifyLocation("SPA", "GENERAL")).toBe("AREAS");
    expect(classifyLocation("ZONE", "DIRTY")).toBe("DIRTY");
    expect(classifyLocation("LAUNDRY", "DIRTY")).toBe("DIRTY");
    expect(classifyLocation("LAUNDRY", "IN_PROCESS")).toBe("LAUNDRY");
    expect(classifyLocation("LAUNDRY", "CLEAN")).toBe("CLEAN");
    expect(classifyLocation("POINT", "LENT")).toBe("LENT");
    expect(classifyLocation("LAUNDRY", "QUARANTINE")).toBe("QUARANTINE");
    expect(classifyLocation("CENTRAL", "GENERAL")).toBe("STORE");
    expect(classifyLocation("NEW_LINEN", "GENERAL")).toBe("STORE");
    expect(classifyLocation("CENTRAL", "HOLD")).toBeNull();
  });

  test("cuadre: etapas + otros + tránsito iguala al resumen (habitaciones aparte)", () => {
    const rows = buildFlowRows(
      ["a"],
      [
        { productId: "a", warehouseKind: "ZONE", locationCode: "GENERAL", quantity: 10 },
        { productId: "a", warehouseKind: "LAUNDRY", locationCode: "CLEAN", quantity: 5 },
        { productId: "a", warehouseKind: "CENTRAL", locationCode: "HOLD", quantity: 2 },
      ],
      new Map([["a", 3]]),
      new Map([["a", 4]])
    );
    expect(rows[0].stages.LENT).toBe(3);
    expect(rows[0].total).toBe(24);
    expect(flowMismatches(rows, new Map([["a", 21]]))).toEqual([]);
    expect(flowMismatches(rows, new Map([["a", 20]]))).toEqual(["a"]);
  });

  test("servicio con datos fake: reconciled contra stock.summary", async () => {
    const db = {
      hotelProduct: { findMany: async () => [{ id: "a", code: "BL-1", name: "Sábana", size: null }] },
      hotelStock: {
        findMany: async () => [
          { productId: "a", quantity: 7, warehouse: { kind: "ZONE" }, location: { code: "DIRTY" } },
          { productId: "a", quantity: 9, warehouse: { kind: "NEW_LINEN" }, location: { code: "GENERAL" } },
        ],
      },
      hotelMovementLine: { findMany: async () => [{ productId: "a", quantity: 2 }] },
      hotelRoomExtra: { findMany: async () => [{ productId: "a", quantity: 1 }] },
    };
    const stock = { summary: async () => [{ productId: "a", total: 18 }] };
    const board = await new HotelLinenFlowService(db as never, stock as never).board("LINEN");
    expect(board.reconciled).toBe(true);
    expect(board.totals.total).toBe(19);
    expect(board.items[0].stages.DIRTY).toBe(7);
    expect(board.items[0].stages.LENT).toBe(1);
    const bad = await new HotelLinenFlowService(db as never, { summary: async () => [{ productId: "a", total: 99 }] } as never).board("LINEN");
    expect(bad.reconciled).toBe(false);
  });
});
