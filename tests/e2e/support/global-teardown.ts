import { db, limpiarDatosE2E } from "./db";

/**
 * Borra todo lo que creó la suite. Los usuarios `e2e_*` se quedan a propósito:
 * son idempotentes y evitan rehashear la contraseña en cada corrida.
 */
export default async function globalTeardown(): Promise<void> {
  const borrado = await limpiarDatosE2E();
  console.log(
    `[e2e] limpieza final: ${borrado.tipos} tipo(s), ${borrado.dispositivos} dispositivo(s), ${borrado.unidades} unidad(es)`
  );
  await db.$disconnect();
}
