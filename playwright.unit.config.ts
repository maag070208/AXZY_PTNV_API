import { defineConfig } from "@playwright/test";

/**
 * Runner unitario. A propósito NO tiene `globalSetup` ni `webServer`: no toca
 * Postgres ni levanta la API, solo evalúa la lógica pura del núcleo de permisos.
 */
export default defineConfig({
  testDir: "./tests/unit",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
