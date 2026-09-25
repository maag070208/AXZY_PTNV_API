import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — tablero de tareas (`/tickets/kanban`) y el avance de una
 * tarea por quien la tiene asignada. La app decide qué botones mostrar con
 * estos datos, así que aquí se fijan. El ticket y la tarea se siembran con
 * Prisma (sin notificaciones) y se borran al final.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const TITULO = `${E2E_PREFIX} Kanban ${RUN}`;

let ticketId: string;
let assignmentId: string;
let adminId: string;

test.beforeAll(async () => {
  const [admin, empleado] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { username: E2E.admin.username }, select: { id: true } }),
    db.user.findUniqueOrThrow({ where: { username: E2E.empleado.username }, select: { id: true } }),
  ]);
  adminId = admin.id;
  const ticket = await db.ticket.create({
    data: { titulo: TITULO, descripcion: "Tarea de prueba", creadoPorId: admin.id },
    select: { id: true },
  });
  ticketId = ticket.id;
  const assignment = await db.ticketAssignment.create({
    data: { ticketId, userId: empleado.id, title: `Tarea ${RUN}`, description: "" },
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
    ctxEmpleado,
  }) => {
    const res = await ctxEmpleado.get("tickets/kanban");
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };
    const tarea = data.find((a) => a.id === assignmentId);
    expect(tarea).toMatchObject({
      ticketId,
      status: "PENDIENTE",
      ticket: { id: ticketId, titulo: TITULO, creadoPorId: adminId, asignadoAId: null, departmentId: null },
    });
  });

  test("el guardia no ve tareas ajenas; sí las de un ticket que levantó", async ({ ctxGuard }) => {
    const guard = await db.user.findUniqueOrThrow({ where: { username: E2E.guard.username }, select: { id: true } });
    const empleado = await db.user.findUniqueOrThrow({ where: { username: E2E.empleado.username }, select: { id: true } });
    const propio = await db.ticket.create({
      data: { titulo: `${TITULO} guardia`, descripcion: "Reporte de portería", creadoPorId: guard.id },
      select: { id: true },
    });
    const tareaPropia = await db.ticketAssignment.create({
      data: { ticketId: propio.id, userId: empleado.id, title: `Revisar ${RUN}`, description: "" },
      select: { id: true },
    });
    try {
      const res = await ctxGuard.get("tickets/kanban");
      expect(res.status()).toBe(200);
      const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((a) => a.id);
      expect(ids).toContain(tareaPropia.id);
      expect(ids).not.toContain(assignmentId);
    } finally {
      await db.ticket.delete({ where: { id: propio.id } });
    }
  });

  test("quien tiene la tarea solo la avanza hasta revisión; completarla es de ADMIN o GERENTE", async ({
    ctxEmpleado,
    ctxAdmin,
  }) => {
    const mover = (ctx: typeof ctxEmpleado, status: string) =>
      ctx.put(`tickets/${ticketId}/assignments/${assignmentId}`, { data: { status } });

    expect((await mover(ctxEmpleado, "EN_PROGRESO")).status()).toBe(200);
    // Regresarla no se permite.
    expect((await mover(ctxEmpleado, "PENDIENTE")).status()).toBe(400);
    expect((await mover(ctxEmpleado, "COMPLETADA")).status()).toBe(403);
    expect((await mover(ctxEmpleado, "EN_REVISION")).status()).toBe(200);
    expect((await mover(ctxEmpleado, "EN_PROGRESO")).status()).toBe(400);
    expect((await mover(ctxAdmin, "COMPLETADA")).status()).toBe(200);
  });
});
