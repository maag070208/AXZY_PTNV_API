import { E2E, assertBaseDeDatosSegura } from "./env";
import { db, limpiarDatosE2E } from "./db";
import { provisionarUsuariosE2E } from "./provision";

/**
 * Deja la base lista antes de la corrida:
 *  1. verifica que sea una base local (la suite borra filas),
 *  2. espera a que la API responda,
 *  3. provisiona los usuarios de prueba (ADMIN y EMPLEADO),
 *  4. limpia residuos de corridas anteriores que se hayan cortado a la mitad.
 */
const esperarApi = async (intentos = 30): Promise<void> => {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(E2E.healthUrl);
      if (res.ok) return;
    } catch {
      /* todavía no levanta */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`La API no respondió en ${E2E.healthUrl} tras ${intentos}s`);
};

export default async function globalSetup(): Promise<void> {
  assertBaseDeDatosSegura();
  await esperarApi();
  await provisionarUsuariosE2E();

  const residuos = await limpiarDatosE2E();
  if (residuos.tipos > 0) {
    console.log(
      `[e2e] limpieza previa: ${residuos.tipos} tipo(s), ${residuos.dispositivos} dispositivo(s), ${residuos.unidades} unidad(es)`
    );
  }
  await db.$disconnect();
}
