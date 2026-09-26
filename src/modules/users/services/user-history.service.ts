import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import type { UserHistoryEntryEntity } from "../models/entity/user.entity";

export class UserHistoryService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async getHistory(userId: string): Promise<UserHistoryEntryEntity[]> {
    const entries: UserHistoryEntryEntity[] = [];

    const [
      custodiedLoans,
      createdMovements,
      createdTickets,
      assignedTickets,
      ticketComments,
      auditLogs,
    ] = await this.db.$transaction([
      this.db.loan.findMany({
        where: { custodianId: userId },
        select: { id: true, number: true, date: true, status: true },
        orderBy: { date: "desc" },
      }),
      this.db.movement.findMany({
        where: { createdById: userId },
        select: { id: true, type: true, date: true, reason: true },
        orderBy: { date: "desc" },
      }),
      this.db.ticket.findMany({
        where: { createdById: userId },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.db.ticket.findMany({
        where: { assignedToId: userId },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.db.ticketComment.findMany({
        where: { authorId: userId },
        select: { id: true, text: true, createdAt: true, ticketId: true },
        orderBy: { createdAt: "desc" },
      }),
      this.db.auditLog.findMany({
        where: { entityType: "User", entityId: userId },
        select: {
          id: true,
          action: true,
          newState: true,
          metadata: true,
          userId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    for (const p of custodiedLoans) {
      entries.push({
        id: `prestamo-${p.id}`,
        type: "LOAN_CUSTODIAN",
        title: "Responsable de préstamo",
        detail: `${p.number} — ${p.status}`,
        timestamp: p.date,
        refId: p.id,
      });
    }

    for (const m of createdMovements) {
      entries.push({
        id: `movimiento-${m.id}`,
        type: "MOVEMENT",
        title: "Movimiento registrado",
        detail: `${m.type}${m.reason ? ` — ${m.reason}` : ""}`,
        timestamp: m.date,
        refId: m.id,
      });
    }

    for (const t of createdTickets) {
      entries.push({
        id: `ticket-creado-${t.id}`,
        type: "TICKET_CREATED",
        title: "Ticket creado",
        detail: `${t.title} — ${t.status}`,
        timestamp: t.createdAt,
        refId: t.id,
      });
    }

    for (const t of assignedTickets) {
      entries.push({
        id: `ticket-asig-${t.id}`,
        type: "TICKET_ASSIGNED",
        title: "Ticket asignado",
        detail: `${t.title} — ${t.status}`,
        timestamp: t.createdAt,
        refId: t.id,
      });
    }

    for (const c of ticketComments) {
      entries.push({
        id: `comment-${c.id}`,
        type: "TICKET_COMMENT",
        title: "Comentario en ticket",
        detail: `Ticket ${c.ticketId}: "${c.text}"`,
        timestamp: c.createdAt,
        refId: c.ticketId,
      });
    }

    for (const log of auditLogs) {
      if (log.action === "USER_DEACTIVATED") {
        const reason =
          (log.metadata as { reason?: string } | null)?.reason ?? "Sin motivo especificado";
        entries.push({
          id: `audit-${log.id}`,
          type: "USER_DEACTIVATED",
          title: "Baja de usuario",
          detail: `Motivo: ${reason}`,
          timestamp: log.createdAt,
        });
      } else if (log.action === "USER_REACTIVATED") {
        entries.push({
          id: `audit-${log.id}`,
          type: "USER_REACTIVATED",
          title: "Reactivación de usuario",
          detail: "Cuenta reactivada y campos de baja limpiados",
          timestamp: log.createdAt,
        });
      }
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return entries;
  }
}