import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import type { UserHistoryEntryEntity } from "../models/entity/user.entity";

export class UserHistoryService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async getHistory(userId: string): Promise<UserHistoryEntryEntity[]> {
    const entries: UserHistoryEntryEntity[] = [];

    const [prestamosResponsable, movimientosCreados, ticketsCreados, ticketsAsignados, ticketComments] =
      await this.db.$transaction([
        this.db.prestamo.findMany({
          where: { responsableId: userId },
          select: { id: true, consecutivo: true, fecha: true, status: true },
          orderBy: { fecha: "desc" },
        }),
        this.db.movimiento.findMany({
          where: { usuarioId: userId },
          select: { id: true, tipo: true, fecha: true, motivo: true },
          orderBy: { fecha: "desc" },
        }),
        this.db.ticket.findMany({
          where: { creadoPorId: userId },
          select: { id: true, titulo: true, status: true, creadoEn: true },
          orderBy: { creadoEn: "desc" },
        }),
        this.db.ticket.findMany({
          where: { asignadoAId: userId },
          select: { id: true, titulo: true, status: true, creadoEn: true },
          orderBy: { creadoEn: "desc" },
        }),
        this.db.ticketComment.findMany({
          where: { autorId: userId },
          select: { id: true, texto: true, creadoEn: true, ticketId: true },
          orderBy: { creadoEn: "desc" },
        }),
      ]);

    for (const p of prestamosResponsable) {
      entries.push({
        id: `prestamo-${p.id}`,
        type: "PRESTAMO_RESPONSABLE",
        title: "Responsable de préstamo",
        detail: `${p.consecutivo} — ${p.status}`,
        timestamp: p.fecha,
        refId: p.id,
      });
    }

    for (const m of movimientosCreados) {
      entries.push({
        id: `movimiento-${m.id}`,
        type: "MOVIMIENTO",
        title: "Movimiento registrado",
        detail: `${m.tipo}${m.motivo ? ` — ${m.motivo}` : ""}`,
        timestamp: m.fecha,
        refId: m.id,
      });
    }

    for (const t of ticketsCreados) {
      entries.push({
        id: `ticket-creado-${t.id}`,
        type: "TICKET_CREADO",
        title: "Ticket creado",
        detail: `${t.titulo} — ${t.status}`,
        timestamp: t.creadoEn,
        refId: t.id,
      });
    }

    for (const t of ticketsAsignados) {
      entries.push({
        id: `ticket-asig-${t.id}`,
        type: "TICKET_ASIGNADO",
        title: "Ticket asignado",
        detail: `${t.titulo} — ${t.status}`,
        timestamp: t.creadoEn,
        refId: t.id,
      });
    }

    for (const c of ticketComments) {
      entries.push({
        id: `comment-${c.id}`,
        type: "TICKET_COMENTARIO",
        title: "Comentario en ticket",
        detail: `Ticket ${c.ticketId}: "${c.texto}"`,
        timestamp: c.creadoEn,
        refId: c.ticketId,
      });
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return entries;
  }
}