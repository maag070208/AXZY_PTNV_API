import { test, expect } from "@playwright/test";
import {
  assertCanCount,
  assertNotFloorAssistant,
  assertProcessScope,
  assertSupplierReturnScope,
  assertTransferSendScope,
  linenScopeProfile,
} from "../../src/modules/hotel-store/linen/services/role-scope-rules";

const FLOOR = ["FLOOR_ASSISTANT"];
const LAUNDRY = ["HOTEL_LAUNDRY"];
const code = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "OTHER";
  }
};

test.describe("linenScopeProfile", () => {
  test("solo restringe si todos los roles son el mismo puesto", () => {
    expect(linenScopeProfile(FLOOR)).toBe("FLOOR_ASSISTANT");
    expect(linenScopeProfile(LAUNDRY)).toBe("LAUNDRY");
    expect(linenScopeProfile(["FLOOR_ASSISTANT", "HOUSEKEEPING_SUPERVISOR"])).toBeNull();
    expect(linenScopeProfile(["ADMIN"])).toBeNull();
    expect(linenScopeProfile(undefined)).toBeNull();
  });
});

test.describe("Auxiliar de piso", () => {
  const ok = { fromKind: "ZONE", toKind: "LAUNDRY", fromLocationCodes: ["DIRTY"], toLocationCodes: ["DIRTY"] };
  test("sucio ZONE/DIRTY -> LAUNDRY pasa", () => {
    expect(code(() => assertTransferSendScope(FLOOR, ok))).toBeNull();
  });
  test("limpio, otro origen u otro destino se rechazan", () => {
    expect(code(() => assertTransferSendScope(FLOOR, { ...ok, fromLocationCodes: ["GENERAL"] }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(FLOOR, { ...ok, fromKind: "CENTRAL" }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(FLOOR, { ...ok, toKind: "ZONE" }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(FLOOR, { ...ok, toLocationCodes: ["CLEAN"] }))).not.toBeNull();
  });
  test("no consulta existencias ni cuenta", () => {
    expect(code(() => assertNotFloorAssistant(FLOOR))).toBe("HOTEL_SCOPE_FLOOR_ASSISTANT");
    expect(code(() => assertCanCount(FLOOR))).not.toBeNull();
    expect(code(() => assertNotFloorAssistant(["HOUSEKEEPING_SUPERVISOR"]))).toBeNull();
  });
  test("no devuelve a proveedor", () => {
    expect(code(() => assertSupplierReturnScope(FLOOR, ["DIRTY"]))).not.toBeNull();
  });
});

test.describe("Lavandería", () => {
  const ok = { fromKind: "LAUNDRY", toKind: "ZONE", fromLocationCodes: ["CLEAN"] };
  test("limpio LAUNDRY/CLEAN -> ZONE/POINT/SPA pasa", () => {
    for (const toKind of ["ZONE", "POINT", "SPA"]) expect(code(() => assertTransferSendScope(LAUNDRY, { ...ok, toKind }))).toBeNull();
  });
  test("sucio, cuarentena u otro destino se rechazan", () => {
    expect(code(() => assertTransferSendScope(LAUNDRY, { ...ok, fromLocationCodes: ["DIRTY"] }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(LAUNDRY, { ...ok, fromLocationCodes: ["QUARANTINE"] }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(LAUNDRY, { ...ok, toKind: "CENTRAL" }))).not.toBeNull();
    expect(code(() => assertTransferSendScope(LAUNDRY, { ...ok, fromKind: "ZONE" }))).not.toBeNull();
  });
  test("no cuenta", () => {
    expect(code(() => assertCanCount(LAUNDRY))).not.toBeNull();
  });
  test("Cuarentena solo con gerencia o supervisión general", () => {
    const moves = [{ from: "QUARANTINE" }];
    expect(code(() => assertProcessScope(LAUNDRY, moves))).toBe("HOTEL_SCOPE_LAUNDRY_QUARANTINE");
    expect(code(() => assertProcessScope(["HOTEL_OPS_MANAGER"], moves))).toBeNull();
    expect(code(() => assertProcessScope(["ADMIN"], moves))).toBeNull();
    expect(code(() => assertProcessScope(LAUNDRY, [{ from: "DIRTY" }]))).toBeNull();
    expect(code(() => assertSupplierReturnScope(LAUNDRY, ["QUARANTINE"]))).not.toBeNull();
    expect(code(() => assertSupplierReturnScope(["HOTEL_GENERAL_SUPERVISOR"], ["QUARANTINE"]))).toBeNull();
  });
});
