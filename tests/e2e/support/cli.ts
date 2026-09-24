/**
 * CLI de la base de pruebas, para que otros paquetes (la suite de UI en `web/`)
 * reutilicen la provisión y la limpieza sin duplicar Prisma ni el .env:
 *
 *   npm run test:e2e:provision   # usuarios de prueba + limpia residuos
 *   npm run test:e2e:clean       # borra lo que creó la suite
 */
import { provisionarUsuariosE2E } from "./provision";
import { db, limpiarDatosE2E } from "./db";
import { assertBaseDeDatosSegura } from "./env";
import { cleanOvertimeWeb, seedOvertimeWeb } from "./overtime-seed";

const acciones: Record<string, () => Promise<void>> = {
  async provision() {
    assertBaseDeDatosSegura();
    await provisionarUsuariosE2E();
    const residuos = await limpiarDatosE2E();
    console.log(
      `[e2e] usuarios listos · limpieza previa: ${residuos.tipos} tipo(s), ${residuos.dispositivos} dispositivo(s), ${residuos.unidades} unidad(es), ${residuos.tickets} ticket(s), ${residuos.categorias} categoría(s)`
    );
  },
  async clean() {
    assertBaseDeDatosSegura();
    const borrado = await limpiarDatosE2E();
    console.log(
      `[e2e] limpieza: ${borrado.tipos} tipo(s), ${borrado.dispositivos} dispositivo(s), ${borrado.unidades} unidad(es), ${borrado.tickets} ticket(s), ${borrado.categorias} categoría(s)`
    );
  },
  // Siembra de tiempo extra para la suite de navegador (checadas + vínculo).
  // Imprime la data en una línea marcada para que la suite de `web/` la lea.
  async "seed-overtime"() {
    assertBaseDeDatosSegura();
    const runId = process.argv[3];
    if (!runId) throw new Error("Falta el runId: seed-overtime <runId>");
    const data = await seedOvertimeWeb(runId);
    console.log(`__E2E_SEED__${JSON.stringify(data)}`);
  },
  async "clean-overtime"() {
    assertBaseDeDatosSegura();
    const runId = process.argv[3];
    if (!runId) throw new Error("Falta el runId: clean-overtime <runId>");
    const usuarios = await cleanOvertimeWeb(runId);
    console.log(`[e2e] overtime ${runId}: ${usuarios} usuario(s) borrado(s)`);
  },
};

const accion = process.argv[2];
const ejecutar = acciones[accion ?? ""];

if (!ejecutar) {
  console.error(`Acción desconocida: "${accion}". Usa: ${Object.keys(acciones).join(" | ")}`);
  process.exit(1);
}

ejecutar()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });
