import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import type { UserHistoryEntryEntity } from "../models/entity/user.entity";

export class UserHistoryService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async getHistory(userId: string): Promise<UserHistoryEntryEntity[]> {
    const entries: UserHistoryEntryEntity[] = [];

    const [cartasCreadas, cartasResponsable, cartasEncargado, ticketsCreados, ticketsAsignados, ticketComments, deviceHistory] =
      await this.db.$transaction([
        this.db.cartaResponsiva.findMany({
          where: { creadoPorId: userId },
          select: { id: true, consecutive: true, fecha: true, departamento: true },
          orderBy: { fecha: "desc" },
        }),
        this.db.cartaResponsiva.findMany({
          where: { responsableId: userId },
          select: { id: true, consecutive: true, fecha: true, departamento: true },
          orderBy: { fecha: "desc" },
        }),
        this.db.cartaResponsiva.findMany({
          where: { encargadoId: userId },
          select: { id: true, consecutive: true, fecha: true, departamento: true },
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
        this.db.deviceHistory.findMany({
          where: { autorId: userId },
          select: {
            id: true,
            type: true,
            detail: true,
            createdAt: true,
            device: { select: { id: true, controlActivos: true, descripcion: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    for (const c of cartasCreadas) {
      entries.push({
        id: `carta-creada-${c.id}`,
        type: "CARTA_CREADA",
        title: "Carta creada",
        detail: `${c.consecutive} — ${c.departamento}`,
        timestamp: c.fecha,
        refId: c.id,
      });
    }

    for (const c of cartasResponsable) {
      entries.push({
        id: `carta-resp-${c.id}`,
        type: "CARTA_RESPONSABLE",
        title: "Responsable de carta",
        detail: `${c.consecutive} — ${c.departamento}`,
        timestamp: c.fecha,
        refId: c.id,
      });
    }

    for (const c of cartasEncargado) {
      entries.push({
        id: `carta-enc-${c.id}`,
        type: "CARTA_ENCARGADO",
        title: "Encargado de carta",
        detail: `${c.consecutive} — ${c.departamento}`,
        timestamp: c.fecha,
        refId: c.id,
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

    for (const h of deviceHistory) {
      const typeLabels: Record<string, string> = {
        CREATED: "Dispositivo registrado",
        ASSIGNED: "Dispositivo asignado",
        RETURNED: "Dispositivo devuelto",
        RETIRED: "Dispositivo retirado",
        UPDATED: "Dispositivo actualizado",
        COMMENT: "Comentario en dispositivo",
      };
      entries.push({
        id: `devhist-${h.id}`,
        type: "DISPOSITIVO_HISTORIAL",
        title: typeLabels[h.type] ?? h.type,
        detail: `${h.device.controlActivos} — ${h.device.descripcion}${h.detail ? `: ${h.detail}` : ""}`,
        timestamp: h.createdAt,
        refId: h.device.id,
      });
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return entries;
  }
}