import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — tablero de tareas (`/tickets/kanban`) y el avance de una
 * tarea por quien la tiene asignada. La app decide qué botones mostrar con
 * estos datos, así que aquí se fijan. El ticket y la tarea se siembran con
 * Prisma (sin notificaciones) y se borran al final.
 */
assertSafeDatabase();

const RUN = newRunId();
const TITLE = `${E2E_PREFIX} Kanban ${RUN}`;

let ticketId: string;
let assignmentId: string;
let adminId: string;

test.beforeAll(async () => {
  const [admin, employee] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { username: E2E.admin.username }, select: { id: true } }),
    db.user.findUniqueOrThrow({ where: { username: E2E.employee.username }, select: { id: true } }),
  ]);
  adminId = admin.id;
  const ticket = await db.ticket.create({
    data: { title: TITLE, description: "Tarea de prueba", createdById: admin.id },
    select: { id: true },
  });
  ticketId = ticket.id;
  const assignment = await db.ticketAssignment.create({
    data: { ticketId, userId: employee.id, title: `Tarea ${RUN}`, description: "" },
    select: { id: true },
  });
  assignmentId = assignment.id;
});

test.afterAll(async () => {
  await db.notification.deleteMany({ where: { ticketId } });
  await db.ticket.deleteMany({ where: { id: ticketId } });
});

test.describe("Tickets — kanban (E2E)", () => {
  test("cada tarea trae quién creó el ticket, a quién está asignado y su departamento", async ({
    ctxEmployee,
  }) => {
    const res = await ctxEmployee.get("tickets/kanban");
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    const task = data.find((a) => a.id === assignmentId);
    expect(task).toMatchObject({
      ticketId,
      status: "PENDING",
      ticket: { id: ticketId, title: TITLE, createdById: adminId, assignedToId: null, departmentId: null },
    });
  });

  test("el guardia no ve tareas ajenas; sí las de un ticket que levantó", async ({ ctxGuard }) => {
    const guard = await db.user.findUniqueOrThrow({ where: { username: E2E.guard.username }, select: { id: true } });
    const employee = await db.user.findUniqueOrThrow({ where: { username: E2E.employee.username }, select: { id: true } });
    const own = await db.ticket.create({
      data: { title: `${TITLE} guardia`, description: "Reporte de portería", createdById: guard.id },
      select: { id: true },
    });
    const ownTask = await db.ticketAssignment.create({
      data: { ticketId: own.id, userId: employee.id, title: `Revisar ${RUN}`, description: "" },
      select: { id: true },
    });
    try {
      const res = await ctxGuard.get("tickets/kanban");
      expect(res.status()).toBe(200);
      const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((a) => a.id);
      expect(ids).toContain(ownTask.id);
      expect(ids).not.toContain(assignmentId);
    } finally {
      await db.ticket.delete({ where: { id: own.id } });
    }
  });

  test("quien tiene la tarea solo la avanza hasta revisión; completarla es de ADMIN o GERENTE", async ({
    ctxEmployee,
    ctxAdmin,
  }) => {
    const move = (ctx: typeof ctxEmployee, status: string) =>
      ctx.put(`tickets/${ticketId}/assignments/${assignmentId}`, { data: { status } });

    expect((await move(ctxEmployee, "IN_PROGRESS")).status()).toBe(200);
    // Regresarla no se permite.
    expect((await move(ctxEmployee, "PENDING")).status()).toBe(400);
    expect((await move(ctxEmployee, "COMPLETED")).status()).toBe(403);
    expect((await move(ctxEmployee, "IN_REVIEW")).status()).toBe(200);
    expect((await move(ctxEmployee, "IN_PROGRESS")).status()).toBe(400);
    expect((await move(ctxAdmin, "COMPLETED")).status()).toBe(200);
  });
});
