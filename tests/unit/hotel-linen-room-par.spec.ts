import { test, expect } from "@playwright/test";
import { expectedForRoom, validateRoomParLines } from "../../src/modules/hotel-store/linen/services/room-par-rules";

const V101 = { kingBeds: 2, queenBeds: 0, sofaBeds: 2, bathrooms: 3 };

test.describe("expectedForRoom", () => {
  test("villa V101: 3 baños x 2 toallas = 6 y suma componentes", () => {
    const pars = [
      { component: "BATHROOM", productId: "towel", quantity: 2 },
      { component: "KING_BED", productId: "sheet", quantity: 2 },
      { component: "SOFA_BED", productId: "sheet", quantity: 1 },
      { component: "ROOM", productId: "carpet", quantity: 1 },
    ];
    const expected = expectedForRoom(V101, pars);
    expect(expected.get("towel")).toBe(6);
    expect(expected.get("sheet")).toBe(2 * 2 + 1 * 2);
    expect(expected.get("carpet")).toBe(1);
  });

  test("cuarto DD con 2 queen", () => {
    const room = { kingBeds: 0, queenBeds: 2, sofaBeds: 0, bathrooms: 1 };
    const expected = expectedForRoom(room, [
      { component: "QUEEN_BED", productId: "duvet", quantity: 1 },
      { component: "BATHROOM", productId: "towel", quantity: 2 },
    ]);
    expect(expected.get("duvet")).toBe(2);
    expect(expected.get("towel")).toBe(2);
  });

  test("omite los resultados en cero", () => {
    const expected = expectedForRoom(V101, [
      { component: "QUEEN_BED", productId: "duvet", quantity: 3 },
      { component: "KING_BED", productId: "zero", quantity: 0 },
    ]);
    expect(expected.size).toBe(0);
  });
});

test.describe("validateRoomParLines", () => {
  test("acepta renglones válidos", () => {
    expect(validateRoomParLines([{ component: "ROOM", productId: "a", quantity: 0 }, { component: "BATHROOM", productId: "a", quantity: 999 }])).toEqual([]);
  });

  test("detecta componente, producto, cantidad y duplicados", () => {
    const errors = validateRoomParLines([
      { component: "GARDEN", productId: "a", quantity: 1 },
      { component: "ROOM", productId: " ", quantity: 1 },
      { component: "ROOM", productId: "a", quantity: 1.5 },
      { component: "ROOM", productId: "a", quantity: 1000 },
      { component: "KING_BED", productId: "a", quantity: 1 },
      { component: "KING_BED", productId: "a", quantity: 2 },
    ]);
    expect(errors.map((e) => e.code)).toEqual([
      "HOTEL_ROOM_PAR_COMPONENT_INVALID",
      "HOTEL_ROOM_PAR_PRODUCT_REQUIRED",
      "HOTEL_ROOM_PAR_QUANTITY_INVALID",
      "HOTEL_ROOM_PAR_QUANTITY_INVALID",
      "HOTEL_ROOM_PAR_DUPLICATE",
    ]);
    expect(errors[4].index).toBe(5);
  });
});
