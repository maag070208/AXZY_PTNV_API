import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { assertSafeDatabase } from "./support/env";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E — Interruptor global de correo transaccional (`sys_config` → `ENABLE_SEND_EMAIL`).
 *
 * El flag lo edita el ADMIN por `PUT /sys-config/ENABLE_SEND_EMAIL` (mismo
 * endpoint que usa /catalogos → Notificaciones). Su único efecto es el gate de
 * `enqueueEmail`: con el flag apagado no se encola nada nuevo en `email_logs`;
 * los PENDING existentes siguen su curso (el worker no se toca).
 *
 * Los triggers de correo (p. ej. el welcome de `POST /users`) son
 * fire-and-forget: la respuesta HTTP puede volver antes del INSERT. Por eso los
 * casos positivos usan `expect.poll` y el negativo una espera acotada.
 *
 * NODE_ENV=test en la suite → el worker de la cola NO arranca, así que las filas
 * quedan PENDING y no se envía ningún correo real.
 *
 * Restauración obligatoria: cada test guarda el valor original y lo repone en
 * `finally` (PUT si existía, DELETE si no). El spec `access-report.spec.ts`
 * (clave TZ) es el precedente de manipular `sys_config` por Prisma/HTTP.
 */
assertSafeDatabase();

const KEY = "ENABLE_SEND_EMAIL";

interface ConfigOriginal {
  value: string;
  description: string | null;
}

const readOriginal = async (): Promise<ConfigOriginal | null> => {
  const row = await db.sysConfig.findUnique({ where: { key: KEY } });
  return row ? { value: row.value, description: row.description } : null;
};

const restore = async (
  adminReq: APIRequestContext,
  original: ConfigOriginal | null
): Promise<void> => {
  if (original) {
    await adminReq.put(`sys-config/${KEY}`, {
      data: { value: original.value, description: original.description ?? undefined },
    });
  } else {
    await adminReq.delete(`sys-config/${KEY}`);
  }
};

const setFlag = async (
  adminReq: APIRequestContext,
  value: string
): Promise<void> => {
  const res = await adminReq.put(`sys-config/${KEY}`, {
    data: { value, description: "E2E ENABLE_SEND_EMAIL" },
  });
  expect(res.status()).toBe(200);
};

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

/** Crea un usuario víctima CON email para que dispare el welcome por cola. */
const createVictimWithEmail = async (
  adminReq: APIRequestContext,
  suffix: string
): Promise<{ id: string; email: string }> => {
  const username = `e2e_mail_${runId}_${suffix}`.toLowerCase();
  const email = `${username}@example.com`;
  const res = await adminReq.post("users", {
    data: {
      username,
      password: "E2E-Mail-2026!",
      name: `E2E Mail ${suffix}`,
      role: "EMPLOYEE",
      email,
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `No se pudo crear el usuario víctima (${res.status()}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, email };
};

const clearVictim = async (victimId: string): Promise<void> => {
  // email_logs y audit_logs guardan entityId como string libre (sin FK), así que
  // se borran a mano para no dejar filas huérfanas.
  await db.emailLog.deleteMany({ where: { entityId: victimId } });
  await db.auditLog.deleteMany({
    where: { entityType: "User", entityId: victimId },
  });
  await db.user.delete({ where: { id: victimId } }).catch(() => {
    /* si queda una referencia dura, el global-teardown lo recoge */
  });
};

const logsDe = (victimId: string): Promise<number> =>
  db.emailLog.count({ where: { entityType: "User", entityId: victimId } });

test.describe("sys_config ENABLE_SEND_EMAIL (E2E)", () => {
  test("apagado bloquea el encolado de correos nuevos", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    let victim: { id: string } | null = null;
    try {
      await setFlag(ctxAdmin, "false");
      victim = await createVictimWithEmail(ctxAdmin, "off");

      // El trigger es fire-and-forget: damos un margen acotado para que corra
      // y comprobamos que NO dejó fila alguna.
      await new Promise((r) => setTimeout(r, 800));
      expect(await logsDe(victim.id)).toBe(0);
    } finally {
      if (victim) await clearVictim(victim.id);
      await restore(ctxAdmin, original);
    }
  });

  test("encendido vuelve a encolar", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    let victim: { id: string } | null = null;
    try {
      await setFlag(ctxAdmin, "true");
      victim = await createVictimWithEmail(ctxAdmin, "on");

      await expect.poll(() => logsDe(victim!.id), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      if (victim) await clearVictim(victim.id);
      await restore(ctxAdmin, original);
    }
  });

  test("clave ausente = habilitado (fail-open)", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    let victim: { id: string } | null = null;
    try {
      const from = await ctxAdmin.delete(`sys-config/${KEY}`);
      expect(from.status()).toBe(204);

      victim = await createVictimWithEmail(ctxAdmin, "absent");
      await expect.poll(() => logsDe(victim!.id), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      if (victim) await clearVictim(victim.id);
      await restore(ctxAdmin, original);
    }
  });

  test("parseo defensivo: 'FALSE' bloquea, '' es 400 y no cambia el flag", async ({ ctxAdmin }) => {
    const original = await readOriginal();
    let victim: { id: string } | null = null;
    try {
      // "FALSE" normaliza a "false" → bloquea.
      await setFlag(ctxAdmin, "FALSE");
      victim = await createVictimWithEmail(ctxAdmin, "def");
      await new Promise((r) => setTimeout(r, 800));
      expect(await logsDe(victim.id)).toBe(0);

      // "" lo rechaza el DTO (min 1) y el valor guardado no cambia.
      const empty = await ctxAdmin.put(`sys-config/${KEY}`, { data: { value: "" } });
      expect(empty.status()).toBe(400);

      const inDb = await db.sysConfig.findUnique({ where: { key: KEY } });
      expect(inDb?.value).toBe("FALSE");
    } finally {
      if (victim) await clearVictim(victim.id);
      await restore(ctxAdmin, original);
    }
  });
});
