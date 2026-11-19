import { test, expect } from "@playwright/test";
import {
  assertCanAddLines,
  assertCanConfirm,
  assertCanDeliver,
  assertDifferenceReport,
  resolveDirtyLines,
  splitPickupResults,
  statusAfterTurnoverDeliver,
  turnoverBucket,
  OPEN_TURNOVER_STATUSES,
  assertCanPickup,
  minutesBetween,
  nearestAreaWarehouse,
  statusAfterTurnoverFulfill,
  turnoverLines,
  zoneChainUp,
} from "../../src/modules/hotel-store/linen/services/supply-request-rules";

const code = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "OTHER";
  }
};

test.describe("pedido por habitación: almacén de piso", () => {
  const zones = [
    { id: "building", parentId: null },
    { id: "floor2", parentId: "building" },
    { id: "wing", parentId: "floor2" },
  ];
  test("cadena de zonas sube hasta la raíz", () => {
    expect(zoneChainUp(zones, "wing")).toEqual(["wing", "floor2", "building"]);
    expect(zoneChainUp([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "a")).toEqual(["a", "b"]);
  });
  test("elige el almacén de la zona más cercana", () => {
    const warehouses = [{ id: "w-building", zoneId: "building" }, { id: "w-floor2", zoneId: "floor2" }];
    expect(nearestAreaWarehouse(zoneChainUp(zones, "wing"), warehouses)?.id).toBe("w-floor2");
    expect(nearestAreaWarehouse(zoneChainUp(zones, "wing"), [{ id: "x", zoneId: "other" }])).toBeNull();
  });
});

test.describe("pedido por habitación: renglones", () => {
  const suggested = [{ productId: "sheet", quantity: 4 }, { productId: "towel", quantity: 2 }];
  test("sin lista propia usa el sugerido", () => {
    expect(turnoverLines(suggested)).toEqual([{ productId: "sheet", requestedQty: 4 }, { productId: "towel", requestedQty: 2 }]);
  });
  test("la lista de la supervisora manda, descarta ceros y admite extras", () => {
    const out = turnoverLines(suggested, [{ productId: "sheet", requestedQty: 3 }, { productId: "towel", requestedQty: 0 }, { productId: "pillow", requestedQty: 1 }]);
    expect(out).toEqual([{ productId: "sheet", requestedQty: 3 }, { productId: "pillow", requestedQty: 1 }]);
  });
  test("rechaza vacío, repetidos y negativos", () => {
    expect(code(() => turnoverLines([{ productId: "a", quantity: 0 }]))).toBe("HOTEL_SUPPLY_NOTHING_TO_REQUEST");
    expect(code(() => turnoverLines([], [{ productId: "a", requestedQty: 1 }, { productId: "a", requestedQty: 2 }]))).toBe("HOTEL_SUPPLY_LINES_DUPLICATE");
    expect(code(() => turnoverLines([], [{ productId: "a", requestedQty: -1 }]))).toBe("HOTEL_QUANTITY_INVALID");
  });
});

test.describe("pedido por habitación: recoger y entregar", () => {
  const ready = { status: "READY_FOR_PICKUP", origin: "ROOM_TURNOVER", carrierUserId: null };
  test("surtir deja el pedido listo para recoger", () => {
    expect(statusAfterTurnoverFulfill()).toBe("READY_FOR_PICKUP");
  });
  test("recoger solo si está listo y sin portador", () => {
    expect(code(() => assertCanPickup(ready))).toBeNull();
    expect(code(() => assertCanPickup({ ...ready, carrierUserId: "u1" }))).toBe("HOTEL_SUPPLY_REQUEST_ALREADY_TAKEN");
    expect(code(() => assertCanPickup({ ...ready, status: "SUBMITTED" }))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    expect(code(() => assertCanPickup({ ...ready, origin: "MANUAL" }))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  });
  test("entregar solo quien lo recogió y en camino", () => {
    const moving = { status: "IN_TRANSIT", origin: "ROOM_TURNOVER", carrierUserId: "u1" };
    expect(code(() => assertCanDeliver(moving, "u1"))).toBeNull();
    expect(code(() => assertCanDeliver(moving, "u2"))).toBe("HOTEL_SUPPLY_REQUEST_NOT_CARRIER");
    expect(code(() => assertCanDeliver({ ...moving, status: "READY_FOR_PICKUP" }, "u1"))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  });
  test("minutos transcurridos", () => {
    expect(minutesBetween(new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T10:20:30Z"))).toBe(21);
    expect(minutesBetween(new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T09:00:00Z"))).toBe(0);
  });
});

test.describe("cierre automático al entregar", () => {
  test("entregar deja el pedido RECEIVED y ya no está abierto", () => {
    expect(statusAfterTurnoverDeliver()).toBe("RECEIVED");
    expect(OPEN_TURNOVER_STATUSES).not.toContain("RECEIVED");
    expect(OPEN_TURNOVER_STATUSES).not.toContain("FULFILLED");
    expect(turnoverBucket("RECEIVED")).toBe("DONE");
  });
  test("confirmar queda solo para pedidos manuales", () => {
    expect(code(() => assertCanConfirm("FULFILLED", 0, "MANUAL"))).toBeNull();
    expect(code(() => assertCanConfirm("FULFILLED", 0))).toBeNull();
    expect(code(() => assertCanConfirm("FULFILLED", 0, "ROOM_TURNOVER"))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    expect(code(() => assertCanConfirm("RECEIVED", 0, "ROOM_TURNOVER"))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  });
  test("extras solo con el pedido por habitación en SUBMITTED", () => {
    expect(code(() => assertCanAddLines({ status: "SUBMITTED", origin: "ROOM_TURNOVER" }))).toBeNull();
    expect(code(() => assertCanAddLines({ status: "READY_FOR_PICKUP", origin: "ROOM_TURNOVER" }))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    expect(code(() => assertCanAddLines({ status: "SUBMITTED", origin: "MANUAL" }))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  });
});

test.describe("reportar diferencia", () => {
  const received = { status: "RECEIVED", origin: "ROOM_TURNOVER" };
  const lines = [{ productId: "sheet", receivedQty: 4 }, { productId: "towel", receivedQty: 2 }];
  test("devuelve los renglones a dar de baja", () => {
    expect(assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 1 }], "faltó una")).toEqual([{ productId: "sheet", quantity: 1 }]);
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 4 }], "todo"))).toBeNull();
  });
  test("solo pedidos por habitación RECEIVED", () => {
    expect(code(() => assertDifferenceReport({ ...received, status: "IN_TRANSIT" }, lines, [{ productId: "sheet", missingQty: 1 }], "x"))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
    expect(code(() => assertDifferenceReport({ ...received, origin: "MANUAL" }, lines, [{ productId: "sheet", missingQty: 1 }], "x"))).toBe("HOTEL_SUPPLY_REQUEST_INVALID_STATE");
  });
  test("notas obligatorias, faltante positivo y sin exceder lo recibido", () => {
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 1 }], "  "))).toBe("HOTEL_SUPPLY_DIFFERENCE_NOTES_REQUIRED");
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 1 }], null))).toBe("HOTEL_SUPPLY_DIFFERENCE_NOTES_REQUIRED");
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 0 }], "x"))).toBe("HOTEL_QUANTITY_INVALID");
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 5 }], "x"))).toBe("HOTEL_SUPPLY_DIFFERENCE_EXCEEDS");
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "pillow", missingQty: 1 }], "x"))).toBe("HOTEL_SUPPLY_LINE_NOT_ON_REQUEST");
    expect(code(() => assertDifferenceReport(received, lines, [{ productId: "sheet", missingQty: 1 }, { productId: "sheet", missingQty: 1 }], "x"))).toBe("HOTEL_SUPPLY_LINES_DUPLICATE");
  });
});

test.describe("recoger varias y sucio", () => {
  test("separa tomados y conflictos sin repetir ids", () => {
    expect(splitPickupResults(["a", "b", "c", "a"], ["a", "c"])).toEqual({ picked: ["a", "c"], conflicts: ["b"] });
    expect(splitPickupResults(["a"], [])).toEqual({ picked: [], conflicts: ["a"] });
  });
  test("sucio por omisión = lo entregado; con lista, validada", () => {
    const lines = [{ productId: "sheet", deliveredQty: 4 }, { productId: "towel", deliveredQty: 2 }];
    expect(resolveDirtyLines(lines)).toEqual([{ productId: "sheet", quantity: 4 }, { productId: "towel", quantity: 2 }]);
    expect(resolveDirtyLines(lines, [{ productId: "sheet", quantity: 3 }])).toEqual([{ productId: "sheet", quantity: 3 }]);
    expect(code(() => resolveDirtyLines(lines, [{ productId: "pillow", quantity: 1 }]))).toBe("HOTEL_SUPPLY_LINE_NOT_ON_REQUEST");
    expect(code(() => resolveDirtyLines(lines, [{ productId: "sheet", quantity: -1 }]))).toBe("HOTEL_QUANTITY_INVALID");
  });
});
