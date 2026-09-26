import bcrypt from "bcryptjs";
import { E2E } from "./env";
import { db } from "./db";

/**
 * Crea (o repone) los usuarios que usan las suites E2E. El seed viene del
 * respaldo del cliente y no trae contraseñas conocidas, así que las pruebas
 * traen las suyas. Es idempotente: se puede correr cuantas veces haga falta.
 *
 * Lo usan el global setup de esta suite y, vía `npm run test:e2e:provision`,
 * la suite de UI del paquete `web/`.
 */
export const provisionUsersE2E = async (): Promise<void> => {
  const password = await bcrypt.hash(E2E.password, 10);

  for (const user of [E2E.admin, E2E.employee, E2E.guard]) {
    await db.user.upsert({
      where: { username: user.username },
      update: { password, active: true, role: user.role },
      create: {
        username: user.username,
        name: user.name,
        role: user.role,
        active: true,
        password,
      },
    });
  }

  // Sitio demo del módulo de control de acceso. Idempotente por `code`.
  await db.site.upsert({
    where: { code: E2E.demoSite.code },
    update: { active: true },
    create: {
      name: E2E.demoSite.name,
      code: E2E.demoSite.code,
      active: true,
    },
  });
};
