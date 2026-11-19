import { test, expect } from "@playwright/test";
import {
  DAY_MS,
  HISTORY_RETENTION_DAYS,
  isDirtyReceiptPurgeable,
  isExtraPurgeable,
  isLoanPurgeable,
  isMovementPurgeable,
  isRoomStatusChangePurgeable,
  isShiftClosePurgeable,
  isSupplyRequestPurgeable,
  referenceDate,
  retentionCutoff,
  type MovementCandidate,
} from "../../src/modules/hotel-store/linen/services/history-retention-rules";

const now = new Date("2026-11-19T12:00:00Z");
const cutoff = retentionCutoff(now);
const old = new Date(cutoff.getTime() - DAY_MS);
const recent = new Date(cutoff.getTime() + DAY_MS);

const movement = (over: Partial<MovementCandidate> = {}): MovementCandidate => ({
  status: "ACTIVE",
  createdAt: old,
  updatedAt: old,
  date: old,
  lineProductKinds: ["LINEN"],
  referencedByKept: false,
  openStocktake: false,
  openSourceDoc: false,
  ...over,
});

test.describe("purga de historial de Blancos", () => {
  test("corte a 60 días y fecha de referencia más reciente", () => {
    expect(HISTORY_RETENTION_DAYS).toBe(60);
    expect(cutoff.getTime()).toBe(now.getTime() - 60 * DAY_MS);
    expect(referenceDate(old, null, recent)).toBe(recent);
    expect(referenceDate(null, undefined)).toBeNull();
  });

  test("movimientos: solo cerrados, de Blancos y viejos", () => {
    expect(isMovementPurgeable(movement(), cutoff)).toBe(true);
    expect(isMovementPurgeable(movement({ status: "CANCELLED" }), cutoff)).toBe(true);
    for (const status of ["PENDING_APPROVAL", "IN_TRANSIT", "RECEIVED_WITH_DIFFERENCE"]) {
      expect(isMovementPurgeable(movement({ status }), cutoff)).toBe(false);
    }
    // El corte es estricto y gana la fecha más reciente.
    expect(isMovementPurgeable(movement({ createdAt: cutoff, updatedAt: cutoff, date: cutoff }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ updatedAt: recent }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ receivedAt: recent }), cutoff)).toBe(false);
  });

  test("movimientos: alcance de Blancos y pendientes", () => {
    expect(isMovementPurgeable(movement({ lineProductKinds: [] }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ lineProductKinds: ["LINEN", "CONSUMABLE"] }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ chargeStatus: "PENDING" }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ chargeStatus: "CHARGED" }), cutoff)).toBe(true);
    expect(isMovementPurgeable(movement({ signoffStatus: "PENDING" }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ signoffStatus: "CONFORM" }), cutoff)).toBe(true);
  });

  test("movimientos: se conservan los referenciados por algo que se queda", () => {
    expect(isMovementPurgeable(movement({ referencedByKept: true }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ openStocktake: true }), cutoff)).toBe(false);
    expect(isMovementPurgeable(movement({ openSourceDoc: true }), cutoff)).toBe(false);
  });

  test("pedidos a lavandería: solo RECEIVED/CANCELLED", () => {
    const base = { createdAt: old, updatedAt: old, date: old };
    expect(isSupplyRequestPurgeable({ ...base, status: "RECEIVED" }, cutoff)).toBe(true);
    expect(isSupplyRequestPurgeable({ ...base, status: "CANCELLED" }, cutoff)).toBe(true);
    for (const status of ["DRAFT", "SUBMITTED", "PARTIALLY_FULFILLED", "FULFILLED", "READY_FOR_PICKUP", "IN_TRANSIT"]) {
      expect(isSupplyRequestPurgeable({ ...base, status }, cutoff)).toBe(false);
    }
    expect(isSupplyRequestPurgeable({ ...base, status: "RECEIVED", deliveredAt: recent }, cutoff)).toBe(false);
  });

  test("préstamos: solo devueltos y sin pérdida ligada", () => {
    expect(isLoanPurgeable({ status: "RETURNED", lentAt: old, returnedAt: old }, cutoff)).toBe(true);
    expect(isLoanPurgeable({ status: "RETURNED", lentAt: old, returnedAt: recent }, cutoff)).toBe(false);
    for (const status of ["OPEN", "PARTIAL", "UNRETURNED"]) expect(isLoanPurgeable({ status, lentAt: old }, cutoff)).toBe(false);
    expect(isLoanPurgeable({ status: "RETURNED", lentAt: old, returnedAt: old, guestLossId: "x" }, cutoff)).toBe(false);
  });

  test("adicionales: solo recogidos/cancelados sin pérdida ligada", () => {
    expect(isExtraPurgeable({ status: "COLLECTED", requestedAt: old, collectedAt: old }, cutoff)).toBe(true);
    expect(isExtraPurgeable({ status: "CANCELLED", requestedAt: old }, cutoff)).toBe(true);
    for (const status of ["REQUESTED", "DELIVERED", "MISSING"]) expect(isExtraPurgeable({ status, requestedAt: old }, cutoff)).toBe(false);
    expect(isExtraPurgeable({ status: "COLLECTED", requestedAt: old, guestLossId: "x" }, cutoff)).toBe(false);
  });

  test("recepciones de sucio, cambios de estado y cierres de turno", () => {
    expect(isDirtyReceiptPurgeable({ createdAt: old, date: old }, cutoff)).toBe(true);
    expect(isDirtyReceiptPurgeable({ createdAt: old, date: recent }, cutoff)).toBe(false);
    expect(isRoomStatusChangePurgeable({ createdAt: old, isLatestOfRoom: false }, cutoff)).toBe(true);
    expect(isRoomStatusChangePurgeable({ createdAt: old, isLatestOfRoom: true }, cutoff)).toBe(false);
    expect(isRoomStatusChangePurgeable({ createdAt: recent, isLatestOfRoom: false }, cutoff)).toBe(false);
    expect(isShiftClosePurgeable({ createdAt: old, to: old, loanCount: 0 }, cutoff)).toBe(true);
    expect(isShiftClosePurgeable({ createdAt: old, to: old, loanCount: 1 }, cutoff)).toBe(false);
    expect(isShiftClosePurgeable({ createdAt: old, to: recent, loanCount: 0 }, cutoff)).toBe(false);
  });
});
