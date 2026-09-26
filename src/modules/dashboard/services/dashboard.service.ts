import { prismaClient } from "@core/config/database";
import type { DashboardSummary } from "../models/dto/dashboard.dto";

type Activity = DashboardSummary["recentActivity"][number];

const TYPE_LABELS: Record<string, string> = {
  STOCK_IN: "Entrada",
  LOAN: "Préstamo",
  RETURN: "Devolución",
  LOW: "Baja",
  TRANSFER: "Traspaso",
  ADJUSTMENT_IN: "Ajuste entrada",
  ADJUSTMENT_OUT: "Ajuste salida",
  MAINTENANCE_IN: "A mantenimiento",
  MAINTENANCE_OUT: "Sale de mantenimiento",
  REVERSAL: "Reversión",
};

export class DashboardService {
  constructor(private readonly db = prismaClient) {}

  async summary(): Promise<DashboardSummary> {
    const [units, ticketsTotal, openTickets, ticketsInProgress, closedTickets, loans, activeLoans, materialOutputsTotal, damagedMaterialOutputs, departments, employees, recentMovements, recentTickets, recentLoans, recentMaterialOutputs, assignments, old] =
      await Promise.all([
        this.db.deviceUnit.findMany({ select: { status: true } }),
        this.db.ticket.count({ where: { deletedAt: null } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "OPEN" } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "IN_PROGRESS" } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "CLOSED" } }),
        this.db.loan.count(),
        this.db.loan.count({ where: { status: { in: ["ACTIVE", "PARTIAL"] } } }),
        this.db.materialOutput.count(),
        this.db.materialOutput.count({ where: { reason: "DAMAGED" } }),
        this.db.department.count({ where: { active: true } }),
        this.db.user.count({ where: { role: "EMPLOYEE", active: true } }),
        this.db.movement.findMany({
          orderBy: { date: "desc" },
          take: 8,
          include: { items: { include: { device: true } } },
        }),
        this.db.ticket.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { id: true, title: true, createdAt: true },
        }),
        this.db.loan.findMany({
          orderBy: { date: "desc" },
          take: 8,
          select: { id: true, number: true, date: true },
        }),
        this.db.materialOutput.findMany({
          orderBy: { date: "desc" },
          take: 8,
          select: { id: true, description: true, date: true },
        }),
        this.db.ticketAssignment.findMany({
          select: {
            userId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, jobTitle: true } },
          },
        }),
        this.db.ticket.findMany({
          where: { deletedAt: null, status: { not: "CLOSED" } },
          orderBy: { createdAt: "asc" },
          take: 6,
          select: {
            id: true,
            title: true,
            priority: true,
            createdAt: true,
            assignedTo: { select: { name: true } },
          },
        }),
      ]);

    let available = 0;
    let loaned = 0;
    let retirement = 0;
    for (const u of units) {
      if (u.status === "AVAILABLE") available++;
      else if (u.status === "ON_LOAN") loaned++;
      else if (u.status === "RETIRED") retirement++;
    }

    const activity: Activity[] = [
      ...recentMovements.map((m): Activity => ({
        id: `mov-${m.id}`,
        scope: "inventory",
        message: `${TYPE_LABELS[m.type] ?? m.type}: ${m.items[0]?.device?.name ?? "inventory"}`,
        at: m.date.toISOString(),
        targetId: m.id,
        deviceId: m.items[0]?.deviceId ?? null,
      })),
      ...recentTickets.map((t): Activity => ({
        id: `tkt-${t.id}`,
        scope: "tickets",
        message: `Ticket: ${t.title}`,
        at: t.createdAt.toISOString(),
        targetId: t.id,
        deviceId: null,
      })),
      ...recentLoans.map((c): Activity => ({
        id: `crt-${c.id}`,
        scope: "custodyLetters",
        message: `Préstamo (carta) ${c.number}`,
        at: c.date.toISOString(),
        targetId: c.id,
        deviceId: null,
      })),
      ...recentMaterialOutputs.map((s): Activity => ({
        id: `sal-${s.id}`,
        scope: "materialOutputs",
        message: `Salida: ${s.description}`,
        at: s.date.toISOString(),
        targetId: s.id,
        deviceId: null,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 15);

const DAY_MS = 86_400_000;
    const byUser = new Map<string, { user: { id: string; name: string; jobTitle: string | null }; resolved: number; pending: number; sumMs: number; n: number }>();
    let resolvedTasks = 0;
    let pendingTasks = 0;
    let sumResolutionMs = 0;
    let nResolutions = 0;
    for (const a of assignments) {
      const entry =
        byUser.get(a.userId) ??
        { user: { id: a.user.id, name: a.user.name, jobTitle: a.user.jobTitle }, resolved: 0, pending: 0, sumMs: 0, n: 0 };
      if (a.status === "COMPLETED") {
        entry.resolved += 1;
        const ms = a.updatedAt.getTime() - a.createdAt.getTime();
        if (ms >= 0) {
          entry.sumMs += ms;
          entry.n += 1;
          sumResolutionMs += ms;
          nResolutions += 1;
        }
      } else {
        entry.pending += 1;
      }
      byUser.set(a.userId, entry);
    }
    resolvedTasks = [...byUser.values()].reduce((s, e) => s + e.resolved, 0);
    pendingTasks = [...byUser.values()].reduce((s, e) => s + e.pending, 0);

    const ticketEfficiency = [...byUser.values()]
      .map((e) => ({
        user: e.user,
        resolved: e.resolved,
        pending: e.pending,
        avgDays: e.n > 0 ? Math.round((e.sumMs / e.n / DAY_MS) * 10) / 10 : null,
      }))
      .sort((a, b) => b.resolved - a.resolved || (a.user.name ?? "").localeCompare(b.user.name ?? ""));

    const now = Date.now();
    const urgentTickets = old.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      createdAt: t.createdAt.toISOString(),
      daysOnHold: Math.max(1, Math.floor((now - t.createdAt.getTime()) / DAY_MS)),
      assigned: t.assignedTo?.name ?? null,
    }));

    return {
      devices: {
        total: units.length,
        available,
        assigned: loaned,
        retirement,
      },
      tickets: {
        total: ticketsTotal,
        open: openTickets,
        inProgress: ticketsInProgress,
        closed: closedTickets,
      },
      custodyLetters: { total: loans, active: activeLoans },
      materialOutputs: { total: materialOutputsTotal, damaged: damagedMaterialOutputs },
      departments,
      employees,
      ticketMetrics: {
        resolvedTasks,
        pendingTasks,
        avgResolutionDays: nResolutions > 0 ? Math.round((sumResolutionMs / nResolutions / DAY_MS) * 10) / 10 : null,
      },
      ticketEfficiency,
      urgentTickets,
      recentActivity: activity,
    };
  }
}