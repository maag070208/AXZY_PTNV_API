/**
 * CLI de la base de pruebas, para que otros paquetes (la suite de UI en `web/`)
 * reutilicen la provisión y la limpieza sin duplicar Prisma ni el .env:
 *
 *   npm run test:e2e:provision   # usuarios de prueba + limpia residuos
 *   npm run test:e2e:clean       # borra lo que creó la suite
 */
import { provisionUsersE2E } from "./provision";
import { db, clearDataE2E } from "./db";
import { assertSafeDatabase } from "./env";
import { cleanOvertimeWeb, seedOvertimeWeb } from "./overtime-seed";

const actions: Record<string, () => Promise<void>> = {
  async provision() {
    assertSafeDatabase();
    await provisionUsersE2E();
    const remainder = await clearDataE2E();
    console.log(
      `[e2e] usuarios listos · limpieza previa: ${remainder.types} tipo(s), ${remainder.devices} dispositivo(s), ${remainder.units} unidad(es), ${remainder.tickets} ticket(s), ${remainder.categories} categoría(s)`
    );
  },
  async clean() {
    assertSafeDatabase();
    const deleted = await clearDataE2E();
    console.log(
      `[e2e] limpieza: ${deleted.types} tipo(s), ${deleted.devices} dispositivo(s), ${deleted.units} unidad(es), ${deleted.tickets} ticket(s), ${deleted.categories} categoría(s)`
    );
  },
  // Siembra de tiempo extra para la suite de navegador (checadas + vínculo).
  // Imprime la data en una línea marcada para que la suite de `web/` la lea.
  async "seed-overtime"() {
    assertSafeDatabase();
    const runId = process.argv[3];
    if (!runId) throw new Error("Falta el runId: seed-overtime <runId>");
    const data = await seedOvertimeWeb(runId);
    console.log(`__E2E_SEED__${JSON.stringify(data)}`);
  },
  async "clean-overtime"() {
    assertSafeDatabase();
    const runId = process.argv[3];
    if (!runId) throw new Error("Falta el runId: clean-overtime <runId>");
    const users = await cleanOvertimeWeb(runId);
    console.log(`[e2e] overtime ${runId}: ${users} usuario(s) borrado(s)`);
  },
};

const action = process.argv[2];
const run = actions[action ?? ""];

if (!run) {
  console.error(`Acción desconocida: "${action}". Usa: ${Object.keys(actions).join(" | ")}`);
  process.exit(1);
}

run()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });
