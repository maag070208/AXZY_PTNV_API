import { db, clearDataE2E } from "./db";

/**
 * Borra todo lo que creó la suite. Los usuarios `e2e_*` se quedan a propósito:
 * son idempotentes y evitan rehashear la contraseña en cada corrida.
 */
export default async function globalTeardown(): Promise<void> {
  const deleted = await clearDataE2E();
  console.log(
    `[e2e] limpieza final: ${deleted.types} tipo(s), ${deleted.devices} dispositivo(s), ${deleted.units} unidad(es)`
  );
  await db.$disconnect();
}
