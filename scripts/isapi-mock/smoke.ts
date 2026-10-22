/**
 * Prueba de humo: el cliente ISAPI real del sistema contra el mock local.
 * Solo acepta 127.0.0.1 para no apuntar nunca a un reloj real.
 *
 *   npx ts-node scripts/isapi-mock/smoke.ts
 */
import { IsapiClient } from "../../src/modules/time-clock/services/isapi.client";

const BASE = process.env.MOCK_URL ?? "http://127.0.0.1:4801";
if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) {
  throw new Error("El smoke test solo corre contra el mock en 127.0.0.1");
}

const main = async (): Promise<void> => {
  const client = new IsapiClient(BASE, process.env.MOCK_USER ?? "mock", process.env.MOCK_PASS ?? "mock-pass-123");
  const info = await client.deviceInfo();
  console.log("deviceInfo:", info.serialNumber, info.model);
  const time = await client.time();
  console.log("time:", time.localTime, time.timeMode);
  const count = await client.userCount();
  console.log("userCount:", count.userNumber, "cards:", count.bindCardUserNumber);

  let people = 0;
  const numbers = new Set<string>();
  for await (const page of client.users()) {
    people += page.people.length;
    page.people.forEach((p) => numbers.add(p.employeeNumber));
  }
  console.log("users() leídos:", people, "únicos:", numbers.size);
  if (people !== count.userNumber) throw new Error("El conteo no cuadra con la lista");

  let cardCount = 0;
  for await (const page of client.cards()) cardCount += page.cards.length;
  console.log("tarjetas leídas:", cardCount);
  const last = await client.lastSerialNo(1);
  console.log("lastSerialNo:", last);
  const eventsFrom = new Date(Date.now() - 4 * 86_400_000);
  let events = 0;
  for (const minor of [75, 38, 1]) {
    for await (const batch of client.acsEventsBetween(eventsFrom, new Date(), minor)) events += batch.events.length;
  }
  console.log("eventos leídos:", events);
  console.log("OK: el cliente del sistema lee el mock correctamente");
};

main().catch((err: unknown) => {
  console.error("FALLO:", err instanceof Error ? err.message : err);
  process.exit(1);
});
