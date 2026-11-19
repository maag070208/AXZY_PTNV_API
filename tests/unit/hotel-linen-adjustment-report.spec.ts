import { test, expect } from "@playwright/test";
import {
  adjustmentDirection,
  adjustmentUnitCost,
  adjustmentWarehouseId,
  aggregateAdjustments,
  type AdjustmentAggRow,
} from "../../src/modules/hotel-store/linen/services/adjustment-report-rules";

const row = (o: Partial<AdjustmentAggRow>): AdjustmentAggRow => ({
  status: "ACTIVE",
  quantity: 1,
  totalCost: 10,
  reasonKey: "r1",
  reasonName: "Conteo",
  warehouseKey: "w1",
  warehouseName: "Ropería",
  ...o,
});

test.describe("reporte de ajustes", () => {
  test("dirección y almacén afectado", () => {
    expect(adjustmentDirection("ADJUST_IN")).toBe("IN");
    expect(adjustmentDirection("ADJUST_OUT")).toBe("OUT");
    expect(adjustmentDirection("WRITE_OFF")).toBe("OUT");
    expect(adjustmentWarehouseId({ type: "ADJUST_IN", warehouseId: "a", fromWarehouseId: null, originWarehouseId: null })).toBe("a");
    expect(adjustmentWarehouseId({ type: "WRITE_OFF", warehouseId: "q", fromWarehouseId: "f", originWarehouseId: "o" })).toBe("o");
    expect(adjustmentWarehouseId({ type: "ADJUST_OUT", warehouseId: null, fromWarehouseId: "f", originWarehouseId: null })).toBe("f");
  });

  test("costo unitario: propio o último costo", () => {
    expect(adjustmentUnitCost(5, 9)).toBe(5);
    expect(adjustmentUnitCost(null, 9)).toBe(9);
    expect(adjustmentUnitCost(null, null)).toBeNull();
  });

  test("totales por motivo y almacén; rechazados no suman", () => {
    const agg = aggregateAdjustments([
      row({ quantity: 2, totalCost: 20.5 }),
      row({ quantity: 1.5, totalCost: 10.25, status: "PENDING_APPROVAL" }),
      row({ quantity: 3, totalCost: 99, reasonKey: "r2", reasonName: "Daño", warehouseKey: "w2", warehouseName: "Lavandería" }),
      row({ quantity: 100, totalCost: 1000, status: "CANCELLED" }),
      row({ quantity: 1, totalCost: 0, reasonKey: null, reasonName: null, warehouseKey: null, warehouseName: null }),
    ]);
    expect(agg.total).toEqual({ pieces: 7.5, cost: 129.75 });
    expect(agg.byReason.find((g) => g.key === "r1")).toMatchObject({ pieces: 3.5, cost: 30.75 });
    expect(agg.byReason[0].key).toBe("r2");
    expect(agg.byReason.some((g) => g.key === null)).toBe(true);
    expect(agg.byWarehouse.find((g) => g.key === "w2")).toMatchObject({ pieces: 3, cost: 99 });
    expect(aggregateAdjustments([]).total).toEqual({ pieces: 0, cost: 0 });
  });
});
