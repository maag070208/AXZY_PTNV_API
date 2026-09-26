import { E2E, assertSafeDatabase } from "./env";
import { db, clearDataE2E } from "./db";
import { provisionUsersE2E } from "./provision";

/**
 * Deja la base lista antes de la corrida:
 *  1. verifica que sea una base local (la suite borra filas),
 *  2. espera a que la API responda,
 *  3. provisiona los usuarios de prueba (ADMIN y EMPLEADO),
 *  4. limpia residuos de corridas anteriores que se hayan cortado a la mitad.
 */
const waitForApi = async (attempts = 30): Promise<void> => {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(E2E.healthUrl);
      if (res.ok) return;
    } catch {
      /* todavía no levanta */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`La API no respondió en ${E2E.healthUrl} tras ${attempts}s`);
};

export default async function globalSetup(): Promise<void> {
  assertSafeDatabase();
  await waitForApi();
  await provisionUsersE2E();

  const remainder = await clearDataE2E();
  if (remainder.types > 0) {
    console.log(
      `[e2e] limpieza previa: ${remainder.types} tipo(s), ${remainder.devices} dispositivo(s), ${remainder.units} unidad(es)`
    );
  }
  await db.$disconnect();
}
