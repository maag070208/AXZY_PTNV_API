import { test, expect } from "./support/fixtures";
import { clearTicketsE2E, db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — tickets (`/tickets`): alta, detalle, estado, comentarios,
 * tareas (asignaciones), tablero y categorías.
 *
 * Los tickets se crean con título `E2E …` y las categorías con nombre `E2E …`:
 * el teardown global (y el `afterAll` de aquí) los borra por ese prefijo, junto
 * con notificaciones y correos ligados.
 */
assertSafeDatabase();

const RUN = newRunId();
const TITLE = `${E2E_PREFIX} Ticket ${RUN}`;
const CATEGORY = `${E2E_PREFIX} CAT ${RUN}`;

let ticketId = "";
let categoryId = "";
let employeeId = "";

test.beforeAll(async () => {
  const employee = await db.user.findUnique({
    where: { username: E2E.employee.username },
    select: { id: true },
  });
  employeeId = employee?.id ?? "";
});

test.afterAll(async () => {
  await clearTicketsE2E();
});

test.describe("Tickets (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("tickets")).status()).toBe(401);
    expect((await ctxAnonymous.post("tickets", { data: {} })).status()).toBe(401);
  });

  test("cualquier sesión puede crear un ticket (201) y verlo", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("tickets", {
      data: { title: TITLE, description: `${E2E_PREFIX} Descripción ${RUN}`, priority: "HIGH" },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { id: string; title: string; status: string };
    expect(body).toMatchObject({ title: TITLE, status: "OPEN" });
    ticketId = body.id;

    const one = await ctxAdmin.get(`tickets/${ticketId}`);
    expect(one.status()).toBe(200);
    expect((await one.json()).id).toBe(ticketId);
  });

  test("valida el body (400)", async ({ ctxAdmin }) => {
    expect((await ctxAdmin.post("tickets", { data: { title: "ab", description: "x" } })).status()).toBe(400);
    expect((await ctxAdmin.post("tickets", { data: { title: "Título ok", description: "" } })).status()).toBe(400);
  });

  test("actualiza estado y prioridad (200)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.put(`tickets/${ticketId}`, {
      data: { status: "IN_PROGRESS", priority: "URGENT" },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "IN_PROGRESS", priority: "URGENT" });
  });

  test("agrega un comentario (201)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post(`tickets/${ticketId}/comments`, { data: { text: "comentario E2E" } });
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).text).toBe("comentario E2E");
  });

  test("lista y filtra por tabla (200)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("tickets/query", {
      data: { page: 1, limit: 10, filters: { q: TITLE }, sort: { key: "createdAt", direction: "desc" } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test("tareas: crea la asignación (201), la completa (200) y la retira (200)", async ({
    ctxAdmin,
  }) => {
    expect(employeeId, "e2e_empleado debe existir").toBeTruthy();
    const created = await ctxAdmin.post(`tickets/${ticketId}/assignments`, {
      data: { userId: employeeId, title: `${E2E_PREFIX} Tarea ${RUN}` },
    });
    expect(created.status(), await created.text()).toBe(201);
    const assignment = (await created.json()) as { id: string; status: string };
    expect(assignment.status).toBe("PENDING");

    const updated = await ctxAdmin.put(`tickets/${ticketId}/assignments/${assignment.id}`, {
      data: { status: "COMPLETED" },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await updated.json()).status).toBe("COMPLETED");

    const kanban = await ctxAdmin.get("tickets/kanban");
    expect(kanban.status()).toBe(200);
    expect(Array.isArray((await kanban.json()).data)).toBe(true);

    const removed = await ctxAdmin.delete(`tickets/${ticketId}/assignments/${assignment.id}`);
    expect(removed.status(), await removed.text()).toBe(200);
  });

  test("categorías: EMPLEADO no administra (403); ADMIN crea, edita y borra", async ({
    ctxAdmin,
    ctxEmployee,
  }) => {
    expect((await ctxEmployee.post("tickets/categories", { data: { name: CATEGORY } })).status()).toBe(403);
    expect((await ctxEmployee.get("tickets/categories")).status()).toBe(200);

    const created = await ctxAdmin.post("tickets/categories", { data: { name: CATEGORY } });
    expect(created.status(), await created.text()).toBe(201);
    const cat = (await created.json()) as { id: string; name: string; active: boolean };
    expect(cat).toMatchObject({ name: CATEGORY, active: true });
    categoryId = cat.id;

    const patched = await ctxAdmin.patch(`tickets/categories/${categoryId}`, { data: { active: false } });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).active).toBe(false);

    const removed = await ctxAdmin.delete(`tickets/categories/${categoryId}`);
    expect(removed.status(), await removed.text()).toBe(200);
    categoryId = "";
  });

  test("EMPLEADO puede crear y listar sus tickets (scope propio)", async ({ ctxEmployee }) => {
    const title = `${E2E_PREFIX} Ticket empleado ${RUN}`;
    const created = await ctxEmployee.post("tickets", {
      data: { title, description: `${E2E_PREFIX} Descripción empleado ${RUN}` },
    });
    expect(created.status(), await created.text()).toBe(201);

    const list = await ctxEmployee.get(`tickets?q=${encodeURIComponent(title)}`);
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { data: Array<{ title: string }> };
    expect(body.data.some((t) => t.title === title)).toBe(true);
  });

  test("ADMIN elimina el ticket (200)", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.delete(`tickets/${ticketId}`);
    expect(res.status(), await res.text()).toBe(200);
    ticketId = "";
  });
});
