import { test, expect } from "@playwright/test";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import {
  addBusinessDays,
  aggregateByProduct,
  assertCanApprove,
  assertCanCancel,
  assertCanClose,
  assertReceiptLine,
  assertToleranceAllowed,
  exceedsTolerance,
  holdDueDate,
  lowStockAlertAction,
  orderTotals,
  parseTolerancePct,
  statusAfterReceipt,
  suggestRestock,
} from "../../src/modules/hotel-store/linen/services/purchase-rules";

const failure = (fn: () => unknown): { status: number; code: string } | null => {
  try {
    fn();
    return null;
  } catch (err) {
    const e = err as HttpError;
    return { status: e.status, code: e.code };
  }
};

test.describe("Compras de blancos: reglas puras", () => {
  test("días hábiles: salta sábado y domingo", () => {
    // Lunes 2026-11-02 + 5 hábiles = lunes 2026-11-09.
    expect(addBusinessDays(new Date(2026, 10, 2), 5).getDate()).toBe(9);
    // Viernes 2026-11-06 + 1 hábil = lunes 9.
    expect(addBusinessDays(new Date(2026, 10, 6), 1).getDate()).toBe(9);
    // Sábado 7 + 5 hábiles = viernes 13.
    expect(addBusinessDays(new Date(2026, 10, 7), 5).getDate()).toBe(13);
    expect(holdDueDate(new Date(2026, 10, 4)).getDate()).toBe(11);
    // Cruza el fin de mes.
    expect(addBusinessDays(new Date(2026, 10, 27), 5).getMonth()).toBe(11);
  });

  test("tolerancia P3: dentro no pide nada; encima exige notas y permiso", () => {
    expect(exceedsTolerance(100, 110, 10)).toBe(false);
    expect(exceedsTolerance(100, 110.5, 10)).toBe(true);
    expect(exceedsTolerance(100, 100, 0)).toBe(false);
    expect(failure(() => assertToleranceAllowed(false, null, false))).toBeNull();
    expect(failure(() => assertToleranceAllowed(true, "  ", true))?.code).toBe("HOTEL_PO_OVER_NOTES_REQUIRED");
    expect(failure(() => assertToleranceAllowed(true, "sobró", false))).toEqual({ status: 403, code: "HOTEL_PO_OVER_TOLERANCE_FORBIDDEN" });
    expect(failure(() => assertToleranceAllowed(true, "sobró", true))).toBeNull();
    expect(parseTolerancePct(null)).toBe(10);
    expect(parseTolerancePct("15")).toBe(15);
    expect(parseTolerancePct("abc")).toBe(10);
    expect(parseTolerancePct("-3")).toBe(10);
  });

  test("sugerido de bajo mínimo resta lo pendiente en OC abiertas", () => {
    expect(suggestRestock({ available: 20, min: 40, target: 200, pending: 0 })).toBe(180);
    expect(suggestRestock({ available: 20, min: 40, target: 200, pending: 100 })).toBe(80);
    expect(suggestRestock({ available: 20, min: 40, target: 200, pending: 500 })).toBe(0);
    expect(suggestRestock({ available: 40, min: 40, target: 200, pending: 0 })).toBe(160);
    expect(suggestRestock({ available: 41, min: 40, target: 200, pending: 0 })).toBe(0);
    expect(suggestRestock({ available: 0, min: 0, target: 200, pending: 0 })).toBe(0);
  });

  test("agregación semanal suma por producto", () => {
    expect(
      aggregateByProduct([
        { productId: "a", quantity: 2 },
        { productId: "b", quantity: 1 },
        { productId: "a", quantity: 3 },
      ])
    ).toEqual([
      { productId: "a", quantity: 5 },
      { productId: "b", quantity: 1 },
    ]);
    expect(aggregateByProduct([])).toEqual([]);
  });

  test("estado de la OC tras recepciones", () => {
    expect(statusAfterReceipt([{ quantity: 10, receivedQuantity: 0 }])).toBe("APPROVED");
    expect(statusAfterReceipt([{ quantity: 10, receivedQuantity: 4 }, { quantity: 5, receivedQuantity: 5 }])).toBe("PARTIALLY_RECEIVED");
    expect(statusAfterReceipt([{ quantity: 10, receivedQuantity: 10 }, { quantity: 5, receivedQuantity: 6 }])).toBe("RECEIVED");
  });

  test("aprobar: proveedor requerido y aprobador distinto del creador", () => {
    const order = { status: "DRAFT", supplierId: "s1", createdById: "u1" };
    expect(failure(() => assertCanApprove(order, "u2"))).toBeNull();
    expect(failure(() => assertCanApprove(order, "u1"))).toEqual({ status: 409, code: "HOTEL_PO_SELF_APPROVAL" });
    expect(failure(() => assertCanApprove({ ...order, supplierId: null }, "u2"))?.code).toBe("HOTEL_SUPPLIER_REQUIRED");
    expect(failure(() => assertCanApprove({ ...order, status: "APPROVED" }, "u2"))?.code).toBe("HOTEL_PO_INVALID_STATE");
  });

  test("cancelar y cerrar", () => {
    expect(failure(() => assertCanCancel({ status: "DRAFT" }, 0))).toBeNull();
    expect(failure(() => assertCanCancel({ status: "APPROVED" }, 0))).toBeNull();
    expect(failure(() => assertCanCancel({ status: "APPROVED" }, 1))?.code).toBe("HOTEL_PO_HAS_RECEIPTS");
    expect(failure(() => assertCanCancel({ status: "PARTIALLY_RECEIVED" }, 1))?.code).toBe("HOTEL_PO_HAS_RECEIPTS");
    expect(failure(() => assertCanCancel({ status: "RECEIVED" }, 1))?.code).toBe("HOTEL_PO_INVALID_STATE");
    expect(failure(() => assertCanClose({ status: "PARTIALLY_RECEIVED" }, "no llegó"))).toBeNull();
    expect(failure(() => assertCanClose({ status: "PARTIALLY_RECEIVED" }, " "))?.code).toBe("HOTEL_PO_CLOSE_NOTES_REQUIRED");
    expect(failure(() => assertCanClose({ status: "DRAFT" }, "x"))?.code).toBe("HOTEL_PO_INVALID_STATE");
  });

  test("línea de recepción: aceptado + apartado <= recibido; apartado pide motivo", () => {
    expect(failure(() => assertReceiptLine({ receivedQty: 10, acceptedQty: 8, heldQty: 2, holdReason: "manchada" }))).toBeNull();
    expect(failure(() => assertReceiptLine({ receivedQty: 10, acceptedQty: 9, heldQty: 2, holdReason: "x" }))?.code).toBe("HOTEL_PO_RECEIPT_QUANTITIES_INVALID");
    expect(failure(() => assertReceiptLine({ receivedQty: 10, acceptedQty: 8, heldQty: 2 }))?.code).toBe("HOTEL_PO_HOLD_REASON_REQUIRED");
    expect(failure(() => assertReceiptLine({ receivedQty: 10, acceptedQty: 10, heldQty: 0 }))).toBeNull();
  });

  test("totales con IVA y desglose por tasa", () => {
    const totals = orderTotals([
      { quantity: 10, unitCost: 100, taxRate: 0.16 },
      { quantity: 5, unitCost: 20, taxRate: 0.08 },
      { quantity: 2, unitCost: 50, taxRate: 0.16 },
    ]);
    expect(totals.subtotal).toBe(1200);
    expect(totals.tax).toBe(184);
    expect(totals.total).toBe(1384);
    expect(totals.taxes).toEqual([
      { rate: 0.08, base: 100, tax: 8 },
      { rate: 0.16, base: 1100, tax: 176 },
    ]);
  });

  test("aviso de bajo mínimo: una vez por cruce", () => {
    expect(lowStockAlertAction(true, false)).toBe("ALERT");
    expect(lowStockAlertAction(true, true)).toBe("NONE");
    expect(lowStockAlertAction(false, true)).toBe("CLEAR");
    expect(lowStockAlertAction(false, false)).toBe("NONE");
  });
});
