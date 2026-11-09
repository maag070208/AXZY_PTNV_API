import { test, expect } from "@playwright/test";
import jwt from "jsonwebtoken";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import { assertSpaIsolation } from "../../src/modules/hotel-store/services/kardex-rules";
import { DEFAULT_LOCATIONS } from "../../src/modules/hotel-store/services/warehouse.service";
import {
  AttemptLimiter,
  COSIGN_PURPOSE,
  signCosignToken,
  verifyCosignToken,
} from "../../src/modules/hotel-store/linen/services/cosign-token";

const SECRET = "unit-test-secret";

const statusOf = (fn: () => unknown): { status: number; code: string } | null => {
  try {
    fn();
    return null;
  } catch (err) {
    const e = err as HttpError;
    return { status: e.status, code: e.code };
  }
};

test.describe("Spa aislado (D14)", () => {
  test("un traspaso Spa <-> Lavandería es válido en ambos sentidos", () => {
    expect(statusOf(() => assertSpaIsolation("TRANSFER", "SPA", "LAUNDRY"))).toBeNull();
    expect(statusOf(() => assertSpaIsolation("TRANSFER", "LAUNDRY", "SPA"))).toBeNull();
  });

  test("Spa con cualquier otro tipo de almacén falla con 409 HOTEL_SPA_ISOLATED", () => {
    for (const other of ["CENTRAL", "ZONE", "POINT", "NEW_LINEN", "SPA"]) {
      expect(statusOf(() => assertSpaIsolation("TRANSFER", "SPA", other)), `SPA -> ${other}`).toEqual({
        status: 409,
        code: "HOTEL_SPA_ISOLATED",
      });
      expect(statusOf(() => assertSpaIsolation("TRANSFER", other, "SPA")), `${other} -> SPA`).toEqual({
        status: 409,
        code: "HOTEL_SPA_ISOLATED",
      });
    }
  });

  test("sin Spa, o en movimientos que no son traspaso, no aplica", () => {
    expect(statusOf(() => assertSpaIsolation("TRANSFER", "CENTRAL", "ZONE"))).toBeNull();
    expect(statusOf(() => assertSpaIsolation("WRITE_OFF", "SPA", null))).toBeNull();
    expect(statusOf(() => assertSpaIsolation("INBOUND", null, "SPA"))).toBeNull();
  });
});

test.describe("ubicaciones por defecto por tipo (D4)", () => {
  test("cada tipo conserva su ubicación por defecto primero y suma las nuevas", () => {
    expect(DEFAULT_LOCATIONS.LAUNDRY).toEqual(["DIRTY", "IN_PROCESS", "CLEAN", "QUARANTINE"]);
    expect(DEFAULT_LOCATIONS.ZONE).toEqual(["GENERAL", "DIRTY"]);
    expect(DEFAULT_LOCATIONS.SPA).toEqual(["GENERAL", "DIRTY"]);
    expect(DEFAULT_LOCATIONS.POINT).toEqual(["GENERAL", "DIRTY", "LENT"]);
    expect(DEFAULT_LOCATIONS.CENTRAL).toEqual(["GENERAL", "HOLD"]);
    expect(DEFAULT_LOCATIONS.NEW_LINEN).toEqual(["GENERAL", "HOLD"]);
    expect(DEFAULT_LOCATIONS.EQUIPMENT).toEqual(["GENERAL"]);
    expect(DEFAULT_LOCATIONS.CART).toEqual(["CART"]);
    expect(DEFAULT_LOCATIONS.ADMIN).toEqual(["INITIAL"]);
  });
});

test.describe("cosign token", () => {
  test("firma y verifica el usuario", () => {
    expect(verifyCosignToken(signCosignToken("user-1", SECRET), SECRET)).toBe("user-1");
  });

  test("rechaza otro secreto, vencido, basura y otro propósito", () => {
    const invalid = { status: 401, code: "HOTEL_COSIGN_TOKEN_INVALID" };
    expect(statusOf(() => verifyCosignToken(signCosignToken("u", "other"), SECRET))).toEqual(invalid);
    expect(statusOf(() => verifyCosignToken(signCosignToken("u", SECRET, -10), SECRET))).toEqual(invalid);
    expect(statusOf(() => verifyCosignToken("not-a-token", SECRET))).toEqual(invalid);
    const otherPurpose = jwt.sign({ userId: "u", purpose: "login" }, SECRET);
    expect(statusOf(() => verifyCosignToken(otherPurpose, SECRET))).toEqual(invalid);
    expect(COSIGN_PURPOSE).toBe("linen-cosign");
  });

  test("dura 5 minutos por defecto", () => {
    const { exp, iat } = jwt.decode(signCosignToken("u", SECRET)) as { exp: number; iat: number };
    expect(exp - iat).toBe(300);
  });
});

test.describe("límite de intentos del cosign", () => {
  test("bloquea tras N fallos, libera por ventana y reinicia con un éxito", () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 1000, () => now);
    for (let i = 0; i < 3; i++) limiter.recordFailure("ana");
    expect(statusOf(() => limiter.assertAllowed("ana"))).toEqual({ status: 429, code: "HOTEL_COSIGN_RATE_LIMITED" });
    expect(statusOf(() => limiter.assertAllowed("beto"))).toBeNull();
    now = 1500;
    expect(statusOf(() => limiter.assertAllowed("ana"))).toBeNull();
    limiter.recordFailure("ana");
    limiter.reset("ana");
    limiter.recordFailure("ana");
    expect(statusOf(() => limiter.assertAllowed("ana"))).toBeNull();
  });
});
