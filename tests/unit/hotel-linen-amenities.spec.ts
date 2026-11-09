import { test, expect } from "@playwright/test";
import {
  DIFF_THRESHOLD_PCT,
  addDaysKey,
  atOrBelowMin,
  balanceAt,
  computeAmenityLine,
  countOccupiedNights,
  dayKeys,
  exceedsThreshold,
  netInWindow,
  warehouseEvents,
  weekStartKey,
  weightedStandard,
  type LedgerMovement,
} from "../../src/modules/hotel-store/linen/services/amenity-rules";

const at = (iso: string) => new Date(iso);

test.describe("noches ocupadas", () => {
  const cutoffs = [at("2026-11-02T23:59:00Z"), at("2026-11-03T23:59:00Z"), at("2026-11-04T23:59:00Z")];

  test("cuenta las habitaciones OCCUPIED a las 23:59 de cada día", () => {
    const changes = [
      { roomId: "a", to: "OCCUPIED", createdAt: at("2026-11-01T15:00:00Z") }, // ocupada los 3 días
      { roomId: "b", to: "OCCUPIED", createdAt: at("2026-11-03T10:00:00Z") },
      { roomId: "b", to: "CLEANING", createdAt: at("2026-11-04T10:00:00Z") }, // ocupada solo el día 3
      { roomId: "c", to: "OCCUPIED", createdAt: at("2026-11-04T23:59:30Z") }, // después del corte: no cuenta
    ];
    expect(countOccupiedNights(changes, cutoffs)).toBe(3 + 1);
  });

  test("entrada y salida el mismo día no cuenta esa noche", () => {
    const changes = [
      { roomId: "a", to: "OCCUPIED", createdAt: at("2026-11-02T14:00:00Z") },
      { roomId: "a", to: "CLEANING", createdAt: at("2026-11-02T20:00:00Z") },
    ];
    expect(countOccupiedNights(changes, cutoffs)).toBe(0);
  });

  test("sin historial no hay noches; el orden de los cambios no importa", () => {
    expect(countOccupiedNights([], cutoffs)).toBe(0);
    const shuffled = [
      { roomId: "a", to: "CLEANING", createdAt: at("2026-11-03T08:00:00Z") },
      { roomId: "a", to: "OCCUPIED", createdAt: at("2026-11-01T08:00:00Z") },
    ];
    expect(countOccupiedNights(shuffled, cutoffs)).toBe(1);
  });
});

test.describe("fechas de la semana", () => {
  test("semana jueves a miércoles y rango de días", () => {
    // 2026-11-08 es domingo; la semana jueves(4) inicia el 2026-11-05.
    expect(weekStartKey("2026-11-08", 4)).toBe("2026-11-05");
    expect(weekStartKey("2026-11-05", 4)).toBe("2026-11-05");
    expect(weekStartKey("2026-11-04", 4)).toBe("2026-10-29");
    expect(addDaysKey("2026-11-05", 6)).toBe("2026-11-11");
    expect(dayKeys("2026-11-05", "2026-11-11")).toHaveLength(7);
  });
});

test.describe("estándar ponderado", () => {
  test("promedio por # de habitaciones; la que no lleva el producto cuenta con 0", () => {
    const standard = weightedStandard([
      { lines: [{ productId: "soap", quantity: 2 }, { productId: "shampoo", quantity: 1 }] },
      { lines: [{ productId: "soap", quantity: 2 }] },
      { lines: [{ productId: "soap", quantity: 2 }, { productId: "shampoo", quantity: 2 }] },
      { lines: [] },
    ]);
    expect(standard.get("soap")).toBe(1.5);
    expect(standard.get("shampoo")).toBe(0.75);
    expect(weightedStandard([]).size).toBe(0);
  });
});

test.describe("saldo por libro mayor", () => {
  const W = "w1";
  const movements: LedgerMovement[] = [
    // Recibido dentro de la semana (enviado antes de ella): entra en receivedAt con lo contado.
    { type: "TRANSFER", status: "RECEIVED_WITH_DIFFERENCE", date: at("2026-11-04T10:00:00Z"), receivedAt: at("2026-11-06T10:00:00Z"), fromWarehouseId: "ame", warehouseId: W, lines: [{ productId: "p", quantity: 100, receivedQuantity: 95 }] },
    // En tránsito: no cuenta como entrada.
    { type: "TRANSFER", status: "IN_TRANSIT", date: at("2026-11-07T10:00:00Z"), receivedAt: null, fromWarehouseId: "ame", warehouseId: W, lines: [{ productId: "p", quantity: 50, receivedQuantity: null }] },
    // Extra de habitación: sale del área.
    { type: "ROOM_EXTRA", status: "ACTIVE", date: at("2026-11-07T12:00:00Z"), receivedAt: null, fromWarehouseId: W, warehouseId: null, lines: [{ productId: "p", quantity: 4, receivedQuantity: null }] },
    // Cancelado: ignorado.
    { type: "INBOUND", status: "CANCELLED", date: at("2026-11-07T12:00:00Z"), receivedAt: null, fromWarehouseId: null, warehouseId: W, lines: [{ productId: "p", quantity: 999, receivedQuantity: null }] },
  ];
  const events = warehouseEvents(movements, W);
  const start = at("2026-11-05T06:00:00Z");
  const end = at("2026-11-12T06:00:00Z");

  test("entradas y salidas de la semana", () => {
    expect(netInWindow(events, start, end, "IN").get("p")).toBe(95);
    expect(netInWindow(events, start, end, "OUT").get("p")).toBe(-4);
  });

  test("inicial = saldo actual - movimiento posterior al inicio", () => {
    // Hoy hay 60: inicial = 60 - (95 - 4) = -31 no tiene sentido físico, se usa un actual coherente.
    const current = new Map([["p", 191]]);
    expect(balanceAt(current, events, start).get("p")).toBe(100);
    expect(balanceAt(current, events, end).get("p")).toBe(191);
  });
});

test.describe("fórmulas del renglón", () => {
  test("real, esperado y diferencia %", () => {
    // 100 ocupadas x 2 + 20 extras = 220 esperado; real = 50 + 300 - 120 = 230.
    const r = computeAmenityLine(100, { standardPerRoom: 2, initialStock: 50, supplied: 300, extras: 20, finalStock: 120 });
    expect(r.realConsumption).toBe(230);
    expect(r.expectedConsumption).toBe(220);
    expect(r.diffPct).toBe(4.55);
    expect(exceedsThreshold(r)).toBe(false);
  });

  test("umbral: estrictamente mayor a 10% (positivo o negativo)", () => {
    expect(DIFF_THRESHOLD_PCT).toBe(10);
    const base = { standardPerRoom: 1, initialStock: 0, supplied: 0, extras: 0 };
    // esperado 100.
    const exact = computeAmenityLine(100, { ...base, supplied: 110, finalStock: 0 });
    expect(exact.diffPct).toBe(10);
    expect(exceedsThreshold(exact)).toBe(false);
    const over = computeAmenityLine(100, { ...base, supplied: 111, finalStock: 0 });
    expect(exceedsThreshold(over)).toBe(true);
    const under = computeAmenityLine(100, { ...base, supplied: 89, finalStock: 0 });
    expect(under.diffPct).toBe(-11);
    expect(exceedsThreshold(under)).toBe(true);
  });

  test("sin esperado: diff nula y se señala si hubo consumo real", () => {
    const quiet = computeAmenityLine(0, { standardPerRoom: 1, initialStock: 10, supplied: 0, extras: 0, finalStock: 10 });
    expect(quiet.diffPct).toBeNull();
    expect(exceedsThreshold(quiet)).toBe(false);
    const leaked = computeAmenityLine(0, { standardPerRoom: 1, initialStock: 10, supplied: 0, extras: 0, finalStock: 7 });
    expect(exceedsThreshold(leaked)).toBe(true);
  });
});

test.describe("mínimo de la bodega", () => {
  test("bajo mínimo solo si hay mínimo definido y el saldo lo alcanza", () => {
    expect(atOrBelowMin(5, 5)).toBe(true);
    expect(atOrBelowMin(4, 5)).toBe(true);
    expect(atOrBelowMin(6, 5)).toBe(false);
    expect(atOrBelowMin(0, 0)).toBe(false);
  });
});
