/**
 * Prueba del CRUD de personas y tarjetas contra el mock local (nunca contra un reloj real).
 *
 *   npx ts-node -r tsconfig-paths/register scripts/isapi-mock/crud-smoke.ts
 */
import { IsapiClient } from "../../src/modules/time-clock/services/isapi.client";

const BASE = "http://127.0.0.1:4801";
const client = new IsapiClient(BASE, "mock", "mock-pass-123");

const listNumbers = async (): Promise<string[]> => {
  const out: string[] = [];
  for await (const page of client.users()) out.push(...page.people.map((p) => p.employeeNumber));
  return out;
};
const listCards = async (): Promise<string[]> => {
  const out: string[] = [];
  for await (const page of client.cards()) out.push(...page.cards.map((c) => c.cardNo));
  return out;
};
const expect = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(`FALLO: ${msg}`);
  console.log("ok:", msg);
};

const main = async (): Promise<void> => {
  await fetch(`${BASE}/__mock__/reset`, { method: "POST" });
  const before = await listNumbers();
  await client.userAdd({ employeeNumber: "3001", name: "PRUEBA ALTA", gender: "unknown" });
  expect((await listNumbers()).includes("3001"), "alta de persona");
  await client.userModify({ employeeNumber: "3001", name: "PRUEBA CAMBIADA" });
  await client.cardAdd("3001", "8000000001");
  expect((await listCards()).includes("8000000001"), "alta de tarjeta");
  await client.cardDelete("8000000001");
  expect(!(await listCards()).includes("8000000001"), "baja de tarjeta");
  await client.userDelete("3001");
  expect((await listNumbers()).length === before.length, "baja de persona (vuelve al conteo inicial)");
  await fetch(`${BASE}/__mock__/reset`, { method: "POST" });
  console.log("OK: CRUD verificado contra el mock; estado reiniciado");
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
