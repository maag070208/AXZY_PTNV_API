import { test, expect } from "./support/fixtures";
import { assertSafeDatabase } from "./support/env";

/**
 * E2E — Healthchecks.
 *
 * `GET /health` es liveness: confirma que el proceso responde y NO toca la BD
 * (lo consume Playwright en `webServer.url` y el healthcheck de Docker).
 * `GET /health/ready` es readiness: además hace un `SELECT 1`, así que responde
 * 200 con la BD accesible y 503 si no. Ambos son públicos (sin token).
 */
assertSafeDatabase();

test.describe("Health (E2E)", () => {
  test("GET /health responde 200 sin token", async ({ ctxAnonymous }) => {
    const res = await ctxAnonymous.get("health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", service: "ptnv-api" });
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  test("GET /health/ready confirma la BD", async ({ ctxAnonymous }) => {
    const res = await ctxAnonymous.get("health/ready");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "up" });
  });
});
