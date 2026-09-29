import { test, expect } from "@playwright/test";
import { formatPurchaseOrderNumber, parseEmailRecipients } from "../../src/modules/kitchen/services/purchase-order-rules";

/** Reglas puras de la orden de compra: folio con año y destinatarios del correo. */

test.describe("folio con año", () => {
  test("rellena a 4 dígitos", () => {
    expect(formatPurchaseOrderNumber(2026, 1)).toBe("OC-2026-0001");
    expect(formatPurchaseOrderNumber(2026, 42)).toBe("OC-2026-0042");
    expect(formatPurchaseOrderNumber(2026, 12345)).toBe("OC-2026-12345");
  });
});

test.describe("destinatarios del correo", () => {
  test("separa por coma y recorta espacios", () => {
    expect(parseEmailRecipients(" compras@ejemplo.com , ventas@ejemplo.com ")).toEqual([
      "compras@ejemplo.com",
      "ventas@ejemplo.com",
    ]);
  });

  test("un solo destinatario", () => {
    expect(parseEmailRecipients("proveedor@ejemplo.com")).toEqual(["proveedor@ejemplo.com"]);
  });

  test("vacío o con un correo inválido es null", () => {
    expect(parseEmailRecipients("   ")).toBeNull();
    expect(parseEmailRecipients(",,")).toBeNull();
    expect(parseEmailRecipients("bueno@ejemplo.com, malo")).toBeNull();
    expect(parseEmailRecipients("sin-arroba")).toBeNull();
  });
});
