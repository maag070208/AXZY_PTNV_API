import { test, expect } from "@playwright/test";
import { assertCanSignoff, assertSignoffNotes, signoffApplies } from "../../src/modules/hotel-store/linen/services/signoff-rules";
import { amenityFolio, amenitySuggestion, assertAmenityRoute, assertRecipientValid } from "../../src/modules/hotel-store/linen/services/amenity-delivery-rules";

test.describe("signoffApplies", () => {
  test("limpio de Lavandería a ropería, punto o spa aplica", () => {
    for (const toKind of ["ZONE", "POINT", "SPA"]) expect(signoffApplies({ type: "TRANSFER", fromKind: "LAUNDRY", toKind })).toBe(true);
  });
  test("sucio a Lavandería, otros orígenes y otros tipos no aplican", () => {
    expect(signoffApplies({ type: "TRANSFER", fromKind: "ZONE", toKind: "LAUNDRY" })).toBe(false);
    expect(signoffApplies({ type: "TRANSFER", fromKind: "CENTRAL", toKind: "ZONE" })).toBe(false);
    expect(signoffApplies({ type: "AMENITY_DELIVERY", fromKind: "LAUNDRY", toKind: "ZONE" })).toBe(false);
    expect(signoffApplies({ type: "TRANSFER", fromKind: "LAUNDRY", toKind: "CART" })).toBe(false);
  });
});

test.describe("assertSignoffNotes", () => {
  test("diferencia exige nota; conforme no", () => {
    expect(() => assertSignoffNotes("DIFFERENCE", "  ")).toThrow();
    expect(() => assertSignoffNotes("DIFFERENCE", null)).toThrow();
    expect(() => assertSignoffNotes("DIFFERENCE", "faltan 2")).not.toThrow();
    expect(() => assertSignoffNotes("CONFORM", null)).not.toThrow();
  });
});

test.describe("assertCanSignoff", () => {
  test("quien recibió no firma (409)", () => {
    expect(() => assertCanSignoff({ signoffStatus: "PENDING", receivedById: "u1" }, "u1")).toThrow();
    expect(() => assertCanSignoff({ signoffStatus: "PENDING", receivedById: "u1" }, "u2")).not.toThrow();
  });
  test("solo se firma lo pendiente", () => {
    expect(() => assertCanSignoff({ signoffStatus: null, receivedById: "u1" }, "u2")).toThrow();
    expect(() => assertCanSignoff({ signoffStatus: "CONFORM", receivedById: "u1" }, "u2")).toThrow();
  });
});

test.describe("entrega de amenidades", () => {
  test("folio EA-0001", () => {
    expect(amenityFolio(0)).toBe("EA-0001");
    expect(amenityFolio(11)).toBe("EA-0012");
  });
  test("ruta: origen central y destino ropería de zona", () => {
    expect(() => assertAmenityRoute("CENTRAL", "ZONE")).not.toThrow();
    expect(() => assertAmenityRoute("LAUNDRY", "ZONE")).toThrow();
    expect(() => assertAmenityRoute("CENTRAL", "SPA")).toThrow();
  });
  test("destinataria: rol y zona", () => {
    expect(() => assertRecipientValid({ hasSupervisorRole: true, supervisesZone: true })).not.toThrow();
    expect(() => assertRecipientValid({ hasSupervisorRole: true, supervisesZone: false })).toThrow();
    expect(() => assertRecipientValid({ hasSupervisorRole: false, supervisesZone: true })).toThrow();
  });
  test("sugerido = Σ habitaciones (solo consumibles) − existencia, sin negativos", () => {
    const rooms = [
      { kingBeds: 1, queenBeds: 0, sofaBeds: 0, bathrooms: 1 },
      { kingBeds: 0, queenBeds: 1, sofaBeds: 0, bathrooms: 2 },
    ];
    const pars = [
      { component: "BATHROOM", productId: "soap", quantity: 2 },
      { component: "ROOM", productId: "pen", quantity: 1 },
      { component: "KING_BED", productId: "towel", quantity: 4 },
    ];
    const lines = amenitySuggestion(rooms, pars, new Set(["soap", "pen"]), new Map([["soap", 2], ["pen", 5]]));
    expect(lines).toEqual([{ productId: "soap", expected: 6, onHand: 2, suggested: 4 }]);
  });
});
