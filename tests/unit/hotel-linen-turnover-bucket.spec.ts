import { test, expect } from "@playwright/test";
import { turnoverBucket } from "../../src/modules/hotel-store/linen/services/supply-request-rules";

test.describe("turnoverBucket", () => {
  test("pendiente: enviado o surtido parcial", () => {
    expect(turnoverBucket("SUBMITTED")).toBe("PENDING");
    expect(turnoverBucket("PARTIALLY_FULFILLED")).toBe("PENDING");
  });
  test("en proceso: listo para recoger o en camino", () => {
    expect(turnoverBucket("READY_FOR_PICKUP")).toBe("IN_PROGRESS");
    expect(turnoverBucket("IN_TRANSIT")).toBe("IN_PROGRESS");
  });
  test("lista: entregado o confirmado", () => {
    expect(turnoverBucket("FULFILLED")).toBe("DONE");
    expect(turnoverBucket("RECEIVED")).toBe("DONE");
  });
});
