import bcrypt from "bcryptjs";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — notificaciones del usuario (`/notifications`).
 *
 * Cada endpoint es por-sesión: se crea un usuario propio y sus notificaciones
 * directo en la base, y se limpia todo al terminar. Las notificaciones reales
 * del cliente nunca se tocan.
 */
assertSafeDatabase();

const RUN = newRunId();
const USERNAME = `e2e_notif_${RUN}`.toLowerCase();

let userId = "";
let ctx: APIRequestContext;

const sessionOf = async (username: string): Promise<APIRequestContext> => {
  const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
  const res = await login.post("auth/login", { data: { username, password: E2E.password } });
  expect(res.status(), await res.text()).toBe(200);
  const { token } = (await res.json()) as { token: string };
  await login.dispose();
  return playwrightRequest.newContext({
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
};

test.beforeAll(async () => {
  const password = await bcrypt.hash(E2E.password, 10);
  const user = await db.user.create({
    data: { username: USERNAME, name: "E2E Notificaciones", role: "EMPLOYEE", password },
    select: { id: true },
  });
  userId = user.id;
  await db.notification.createMany({
    data: [
      { userId, type: "ticket.assigned", title: `${E2E_PREFIX} Notificación 1`, detail: "detalle 1" },
      { userId, type: "ticket.comment", title: `${E2E_PREFIX} Notificación 2`, detail: null },
    ],
  });
  ctx = await sessionOf(USERNAME);
});

test.afterAll(async () => {
  if (ctx) await ctx.dispose();
  await db.notification.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

test.describe("Notificaciones (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("notifications")).status()).toBe(401);
    expect((await ctxAnonymous.get("notifications/unread-count")).status()).toBe(401);
  });

  test("lista las notificaciones del usuario y su conteo sin leer", async () => {
    const list = await ctx.get("notifications");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { data: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.data.every((n) => n.userId === userId)).toBe(true);

    const count = await ctx.get("notifications/unread-count");
    expect(count.status()).toBe(200);
    expect((await count.json()).count).toBeGreaterThanOrEqual(2);
  });

  test("filtra solo las no leídas con `?unread=true`", async () => {
    const res = await ctx.get("notifications?unread=true");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: Array<{ read: boolean }> };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data.every((n) => n.read === false)).toBe(true);
  });

  test("marca una como leída (204) y baja el conteo", async () => {
    const before = (await (await ctx.get("notifications/unread-count")).json()).count as number;
    const list = (await (await ctx.get("notifications")).json()) as {
      data: Array<{ id: string; read: boolean }>;
    };
    const target = list.data.find((n) => !n.read)!;

    const read = await ctx.post(`notifications/${target.id}/read`, { data: {} });
    expect(read.status()).toBe(204);

    const after = (await (await ctx.get("notifications/unread-count")).json()).count as number;
    expect(after).toBe(before - 1);
  });

  test("marca todas como leídas (204) y deja el conteo en 0", async () => {
    const readAll = await ctx.post("notifications/read-all", { data: {} });
    expect(readAll.status()).toBe(204);
    expect((await (await ctx.get("notifications/unread-count")).json()).count).toBe(0);
  });

  test("elimina una notificación (204)", async () => {
    const list = (await (await ctx.get("notifications")).json()) as {
      data: Array<{ id: string }>;
      total: number;
    };
    const id = list.data[0].id;
    expect((await ctx.delete(`notifications/${id}`)).status()).toBe(204);

    const after = (await (await ctx.get("notifications")).json()) as { total: number };
    expect(after.total).toBe(list.total - 1);
  });
});
