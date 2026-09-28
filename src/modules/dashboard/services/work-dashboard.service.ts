import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { localDateKey, resolveTimezoneWithConfig, startOfLocalDay } from "@core/utils/timezone";
import { scopeOf, visibleTickets, type UserPermissions } from "@core/permissions";

type SysConfigReader = (key: string) => Promise<string | null>;

/** Un ticket abierto se considera "antiguo" a partir de estos días. */
const STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Tableros de trabajo diario: tickets y tareas (con el alcance de su permiso:
 * lo propio, su área o todo), el equipo que tiene asignado el usuario, los
 * accesos de hoy (guardia) y la salud del sistema (admin).
 */
export class WorkDashboardService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader
  ) {}

  /** Tickets del alcance de `tickets.view`: por estado, sin asignar, antiguos y abiertos por responsable. */
  async tickets(actor: UserPermissions) {
    const where: Prisma.TicketWhereInput = { deletedAt: null, AND: [visibleTickets(actor)] };
    const open: Prisma.TicketWhereInput = { ...where, status: { not: "CLOSED" } };
    const staleBefore = new Date(Date.now() - STALE_DAYS * MS_PER_DAY);
    const [byStatus, unassigned, stale, byAssignee] = await Promise.all([
      this.db.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.db.ticket.count({ where: { ...open, assignedToId: null } }),
      this.db.ticket.findMany({
        where: { ...open, createdAt: { lt: staleBefore } },
        orderBy: { createdAt: "asc" },
        take: 6,
        select: { id: true, title: true, priority: true, status: true, createdAt: true, assignedTo: { select: { name: true } } },
      }),
      this.db.ticket.groupBy({ by: ["assignedToId"], where: { ...open, assignedToId: { not: null } }, _count: { _all: true } }),
    ]);
    const people = await this.db.user.findMany({
      where: { id: { in: byAssignee.map((a) => a.assignedToId!) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
    return {
      scope: scopeOf(actor, "tickets.view"),
      open: count("OPEN"),
      inProgress: count("IN_PROGRESS"),
      closed: count("CLOSED"),
      unassigned,
      staleDays: STALE_DAYS,
      stale: stale.map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), assignedTo: t.assignedTo?.name ?? null })),
      openByAssignee: byAssignee
        .map((a) => ({ userId: a.assignedToId!, name: nameOf.get(a.assignedToId!) ?? "—", open: a._count._all }))
        .sort((a, b) => b.open - a.open)
        .slice(0, 8),
    };
  }

  /**
   * Tareas del alcance de `tasks.view`: las propias (OWN), las de su equipo
   * (AREA: personas de su departamento) o todas; pendientes, atrasadas y por persona.
   */
  async tasks(actor: UserPermissions) {
    const scope = scopeOf(actor, "tasks.view");
    const who: Prisma.TicketAssignmentWhereInput =
      scope === "ALL" ? {} : scope === "AREA" && actor.departmentId ? { user: { departmentId: actor.departmentId } } : { userId: actor.id };
    const pending: Prisma.TicketAssignmentWhereInput = { ...who, status: { not: "COMPLETED" }, ticket: { deletedAt: null } };
    const now = new Date();
    const [byStatus, overdue, byUser] = await Promise.all([
      this.db.ticketAssignment.groupBy({ by: ["status"], where: { ...who, ticket: { deletedAt: null } }, _count: { _all: true } }),
      this.db.ticketAssignment.findMany({
        where: { ...pending, dueDate: { lt: now } },
        orderBy: { dueDate: "asc" },
        take: 6,
        select: { id: true, title: true, dueDate: true, status: true, ticketId: true, user: { select: { name: true } } },
      }),
      this.db.ticketAssignment.groupBy({ by: ["userId"], where: pending, _count: { _all: true } }),
    ]);
    const people = await this.db.user.findMany({ where: { id: { in: byUser.map((u) => u.userId) } }, select: { id: true, name: true } });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
    return {
      scope,
      pending: count("PENDING"),
      inProgress: count("IN_PROGRESS"),
      inReview: count("IN_REVIEW"),
      completed: count("COMPLETED"),
      overdue: overdue.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        ticketId: a.ticketId,
        dueDate: a.dueDate?.toISOString() ?? null,
        name: a.user.name,
      })),
      pendingByUser: byUser
        .map((u) => ({ userId: u.userId, name: nameOf.get(u.userId) ?? "—", pending: u._count._all }))
        .sort((a, b) => b.pending - a.pending)
        .slice(0, 8),
    };
  }

  /** Equipo que el usuario tiene a su cargo (cartas responsivas vigentes a su nombre). */
  async myEquipment(actor: UserPermissions) {
    const loans = await this.db.loan.findMany({
      where: { custodianId: actor.id, status: { in: ["ACTIVE", "PARTIAL"] } },
      orderBy: { date: "desc" },
      select: {
        id: true,
        number: true,
        date: true,
        items: {
          select: {
            quantity: true,
            returnedQuantity: true,
            device: { select: { name: true, brand: true, model: true } },
            units: { where: { returned: false }, select: { deviceUnit: { select: { assetTag: true, serialNumber: true } } } },
          },
        },
      },
    });
    return {
      loans: loans.map((l) => ({
        id: l.id,
        number: l.number,
        date: l.date.toISOString(),
        items: l.items
          .filter((i) => i.quantity > i.returnedQuantity)
          .map((i) => ({
            name: i.device.name,
            brand: i.device.brand,
            model: i.device.model,
            pending: i.quantity - i.returnedQuantity,
            units: i.units.map((u) => u.deviceUnit),
          })),
      })),
    };
  }

  /** Accesos de hoy (portería): entradas, salidas, quién sigue dentro y los últimos registros. */
  async accessToday(actor: UserPermissions) {
    const timezone = await resolveTimezoneWithConfig(undefined, this.sysConfig);
    const date = localDateKey(new Date(), timezone);
    const where: Prisma.AccessEventWhereInput = { voidedAt: null, occurredAt: { gte: startOfLocalDay(date, timezone) } };
    const [events, mine] = await Promise.all([
      this.db.accessEvent.findMany({
        where,
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          type: true,
          occurredAt: true,
          employeeId: true,
          employeeNameSnapshot: true,
          site: { select: { name: true } },
          guard: { select: { name: true } },
        },
      }),
      this.db.accessEvent.count({ where: { ...where, guardId: actor.id } }),
    ]);
    // Quién sigue dentro: su último registro de hoy es una entrada.
    const last = new Map<string, (typeof events)[number]>();
    for (const e of events) last.set(e.employeeId, e);
    const onSite = [...last.values()].filter((e) => e.type === "ENTRY");
    return {
      date,
      timezone,
      entries: events.filter((e) => e.type === "ENTRY").length,
      exits: events.filter((e) => e.type === "EXIT").length,
      registeredByMe: mine,
      onSite: onSite.map((e) => ({
        employeeId: e.employeeId,
        name: e.employeeNameSnapshot,
        since: e.occurredAt.toISOString(),
        site: e.site?.name ?? null,
      })),
      latest: events
        .slice(-10)
        .reverse()
        .map((e) => ({
          id: e.id,
          type: e.type,
          at: e.occurredAt.toISOString(),
          name: e.employeeNameSnapshot,
          site: e.site?.name ?? null,
          guard: e.guard?.name ?? null,
        })),
    };
  }

  /** Salud del sistema (admin): auditor de inventario, relojes y correos. */
  async systemHealth() {
    const since = new Date(Date.now() - 7 * MS_PER_DAY);
    const [audit, clocks, failedEmails, pendingEmails] = await Promise.all([
      this.db.notification.findFirst({
        where: { type: "INVENTORY_AUDIT" },
        orderBy: { createdAt: "desc" },
        select: { title: true, detail: true, createdAt: true },
      }),
      this.db.timeClock.findMany({
        where: { url: { not: null } },
        orderBy: { name: "asc" },
        select: { serialNumber: true, name: true, syncedAt: true, countsAttendance: true },
      }),
      this.db.emailLog.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
      this.db.emailLog.count({ where: { status: "PENDING" } }),
    ]);
    return {
      inventoryAudit: audit ? { title: audit.title, detail: audit.detail, at: audit.createdAt.toISOString() } : null,
      clocks: clocks.map((c) => ({ ...c, syncedAt: c.syncedAt?.toISOString() ?? null })),
      failedEmailsLast7Days: failedEmails,
      pendingEmails,
    };
  }
}
