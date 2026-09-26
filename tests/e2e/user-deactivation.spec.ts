import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, assertBaseDeDatosSegura } from "./support/env";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E — Users de baja (deactivate / reactivate).
 *
 * Cubre los flujos de:
 *   - PATCH /users/:id/deactivate (ADMIN)
 *   - PATCH /users/:id/reactivate (ADMIN)
 *   - POST /auth/login contra cuenta dada de baja (debe responder 403
 *     ACCOUNT_DEACTIVATED, no INVALID_CREDENTIALS, para que la UI pueda
 *     mostrar el motivo).
 *   - Auto-baja (HTTP 400) y dobles operaciones (HTTP 409).
 *   - Permisos: un EMPLEADO no debe poder dar de baja ni reactivar (HTTP 403).
 *
 * Se ejecuta contra la base real. El setup global ya provisiona
 * `e2e_admin` (ADMIN) y `e2e_empleado` (EMPLEADO). Cada test crea su propio
 * usuario víctima vía POST /users para no tocar a los provisionados y lo
 * borra al final junto con los audit_logs que dejó.
 *
 * Notas de seguridad:
 *   - `EMAIL_DRY_RUN=true` debe estar activo en el proceso de la API (el
 *     .env actual no define SMTP_HOST, así que `env.EMAIL_DRY_RUN` cae a
 *     `true` por la regla de `env.config.ts`). Aun así, los usuarios de
 *     prueba se crean SIN email, así que el disparador de correo de baja
 *     se corta en `if (input.notifyUser && result.user.email)` antes de
 *     llegar a `sendEmail`.
 *   - `assertBaseDeDatosSegura` corre en el global-setup; aquí la
 *     invocamos otra vez para que un `node --import` accidental también
 *     falle antes de tocar la base.
 */
assertBaseDeDatosSegura();

interface UsuarioVictima {
  id: string;
  username: string;
  password: string;
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

const crearVictima = async (
  adminReq: APIRequestContext,
  sufijo: string
): Promise<UsuarioVictima> => {
  const username = `e2e_baja_${runId}_${sufijo}`.toLowerCase();
  const password = "E2E-Baja-2026!";
  const res = await adminReq.post("users", {
    data: {
      username,
      password,
      name: `E2E Víctima ${sufijo}`,
      role: "EMPLEADO",
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `No se pudo crear el usuario víctima (${res.status()}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, username, password };
};

const limpiarVictima = async (victimaId: string): Promise<void> => {
  // audit_logs no tiene FK declarada a users (entityId es string libre),
  // así que hay que borrarlas a mano para no dejar filas huérfanas.
  await db.auditLog.deleteMany({
    where: { entityType: "User", entityId: victimaId },
  });
  // Las relaciones vivas del usuario (tickets, attachments, etc.) se
  // eliminan en cascada o ponen a null según la migración. Como los
  // víctimas no se usan para nada más que deactivate/reactivate, un
  // delete plano debería pasar.
  await db.user.delete({ where: { id: victimaId } }).catch(() => {
    /* si por alguna razón quedara una referencia dura, la siguiente
       corrida del global-teardown lo recoge vía limpiarDatosE2E */
  });
};

const idAdmin = async (): Promise<string> => {
  const admin = await db.user.findUnique({ where: { username: E2E.admin.username } });
  if (!admin) throw new Error("e2e_admin no está provisionado (¿corrió globalSetup?)");
  return admin.id;
};

test.describe("Users — deactivate / reactivate (E2E)", () => {
  test("deactivate deja al usuario inactivo, con auditoría y campos de baja poblados", async ({
    ctxAdmin,
  }) => {
    const victima = await crearVictima(ctxAdmin, "happy");
    try {
      const res = await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Renuncia voluntaria", notifyUser: false },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        id: string;
        active: boolean;
        deactivatedAt: string | null;
        deactivatedById: string | null;
        deactivationReason: string | null;
      };
      const adminId = await idAdmin();
      expect(body).toMatchObject({
        id: victima.id,
        active: false,
        deactivatedById: adminId,
        deactivationReason: "Renuncia voluntaria",
      });
      expect(body.deactivatedAt).not.toBeNull();

      // La base cuenta la misma historia.
      const enBase = await db.user.findUnique({ where: { id: victima.id } });
      expect(enBase).toMatchObject({
        active: false,
        deactivatedById: adminId,
        deactivationReason: "Renuncia voluntaria",
      });
      expect(enBase?.deactivatedAt).not.toBeNull();

      // Y la auditoría se emitió con la forma correcta.
      const audit = await db.auditLog.findFirst({
        where: { entityType: "User", entityId: victima.id, action: "USER_DEACTIVATED" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.userId).toBe(adminId);
      expect(audit?.previousState).toMatchObject({ active: true });
      expect(audit?.newState).toMatchObject({
        active: false,
        deactivationReason: "Renuncia voluntaria",
      });
    } finally {
      await limpiarVictima(victima.id);
    }
  });

  test("login de cuenta dada de baja responde 403 con code ACCOUNT_DEACTIVATED", async ({ ctxAdmin, ctxAnonimo }) => {
    const victima = await crearVictima(ctxAdmin, "login");
    try {
      const baja = await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Baja para login", notifyUser: false },
      });
      expect(baja.status()).toBe(200);

      // La cuenta ya no autentica, y el código de error debe permitirle a la
      // UI diferenciar "credenciales inválidas" de "cuenta dada de baja".
      // ctxAnonimo provee un contexto sin Authorization — el patrón que ya
      // usan los demás specs para hablarle a endpoints públicos.
      const res = await ctxAnonimo.post("auth/login", {
        data: { username: victima.username, password: victima.password },
      });
      expect(res.status()).toBe(403);
      const body = (await res.json()) as {
        code?: string;
        message?: string;
        details?: { motivo?: string };
      };
      expect(body.code).toBe("ACCOUNT_DEACTIVATED");
      expect(body.message).toEqual(expect.any(String));
      expect(body.details?.motivo).toBe("Baja para login");
    } finally {
      await limpiarVictima(victima.id);
    }
  });

  test("no permite darse de baja a sí mismo (HTTP 400)", async ({ ctxAdmin }) => {
    const adminId = await idAdmin();
    const res = await ctxAdmin.patch(`users/${adminId}/deactivate`, {
      data: { reason: "Auto-baja", notifyUser: false },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/no puedes darte de baja a ti mismo/i);

    // Y el admin sigue activo y sin campos de baja.
    const admin = await db.user.findUnique({ where: { id: adminId } });
    expect(admin).toMatchObject({
      active: true,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
    });
  });

  test("reactivate limpia campos de baja y deja auditoría USER_REACTIVATED", async ({ ctxAdmin }) => {
    const victima = await crearVictima(ctxAdmin, "react");
    try {
      await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Baja temporal", notifyUser: false },
      });

      const res = await ctxAdmin.patch(`users/${victima.id}/reactivate`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        id: string;
        active: boolean;
        deactivatedAt: string | null;
        deactivatedById: string | null;
        deactivationReason: string | null;
      };
      const adminId = await idAdmin();
      expect(body).toMatchObject({
        id: victima.id,
        active: true,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
      });

      const enBase = await db.user.findUnique({ where: { id: victima.id } });
      expect(enBase).toMatchObject({
        active: true,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
      });

      const auditReact = await db.auditLog.findFirst({
        where: { entityType: "User", entityId: victima.id, action: "USER_REACTIVATED" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditReact).not.toBeNull();
      expect(auditReact?.userId).toBe(adminId);
      expect(auditReact?.previousState).toMatchObject({
        active: false,
        deactivationReason: "Baja temporal",
      });
      expect(auditReact?.newState).toMatchObject({ active: true });
    } finally {
      await limpiarVictima(victima.id);
    }
  });

  test("doble deactivate → 409; doble reactivate → 409", async ({ ctxAdmin }) => {
    const victima = await crearVictima(ctxAdmin, "doble");
    try {
      const baja1 = await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Primera baja", notifyUser: false },
      });
      expect(baja1.status()).toBe(200);

      const baja2 = await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Segunda baja", notifyUser: false },
      });
      expect(baja2.status()).toBe(409);
      const body2 = (await baja2.json()) as { message?: string };
      expect(body2.message).toMatch(/ya estaba dado de baja/i);

      const react1 = await ctxAdmin.patch(`users/${victima.id}/reactivate`);
      expect(react1.status()).toBe(200);

      const react2 = await ctxAdmin.patch(`users/${victima.id}/reactivate`);
      expect(react2.status()).toBe(409);
      const body4 = (await react2.json()) as { message?: string };
      expect(body4.message).toMatch(/ya estaba activo/i);
    } finally {
      await limpiarVictima(victima.id);
    }
  });

  test("un EMPLEADO no puede deactivate ni reactivate (HTTP 403)", async ({ ctxAdmin, ctxEmpleado }) => {
    const victima = await crearVictima(ctxAdmin, "perm");
    try {
      const bajaEmpleado = await ctxEmpleado.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Sin permiso", notifyUser: false },
      });
      expect(bajaEmpleado.status()).toBe(403);

      // Forzamos el camino del 403 de reactivate dando de baja primero
      // legítimamente, para no probar dos efectos por el mismo cause.
      await ctxAdmin.patch(`users/${victima.id}/deactivate`, {
        data: { reason: "Baja para probar permisos", notifyUser: false },
      });

      const reactEmpleado = await ctxEmpleado.patch(`users/${victima.id}/reactivate`);
      expect(reactEmpleado.status()).toBe(403);

      // El usuario sigue inactivo: nadie pudo moverlo.
      const enBase = await db.user.findUnique({ where: { id: victima.id } });
      expect(enBase?.active).toBe(false);
    } finally {
      await limpiarVictima(victima.id);
    }
  });
});