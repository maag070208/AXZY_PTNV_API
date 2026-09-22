import { defineConfig } from "@playwright/test";
import { E2E } from "./tests/e2e/support/env";

const PORT = process.env.PORT ?? "4001";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  globalTeardown: "./tests/e2e/support/global-teardown.ts",

  // Serie a propósito: el consecutivo de préstamo se calcula con `count() + 1`
  // dentro de una transacción Serializable, así que dos préstamos concurrentes
  // chocan. El test `prestamos.spec.ts › concurrencia` cubre ese caso a mano.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { "Content-Type": "application/json" },
    trace: "retain-on-failure",
  },

  // Si la API ya está corriendo en local, se reutiliza; si no, Playwright la
  // levanta con `npm run dev` y espera al health check.
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 90_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
