import { prismaClient } from "@core/config/database";
import { broadcastToUser } from "@core/services/ably";
import type {
  CreateNotificationInput,
  NotificationPort,
} from "../models/entity/notification.entity";

export class NotificationService implements NotificationPort {
  constructor(private readonly db = prismaClient) {}

  createNotification(input: CreateNotificationInput) {
    return this.db.notification.create({ data: input });
  }

  async createManyNotifications(inputs: CreateNotificationInput[]) {
    if (inputs.length === 0) return;
    return this.db.notification.createMany({ data: inputs });
  }

  listNotifications(userId: string, unreadOnly = false) {
    return this.db.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    return this.db.notification.count({ where: { userId, read: false } });
  }

  async markAsRead(id: string, userId: string) {
    return this.db.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.db.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async deleteNotification(id: string, userId: string) {
    return this.db.notification.deleteMany({ where: { id, userId } });
  }

  async notifyTicketComment(
    ticketId: string,
    ticketTitle: string,
    autorId: string,
    autorName: string,
    texto: string
  ) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: { creadoPorId: true, asignadoAId: true },
    });
    if (!ticket) return;

    const recipientIds = new Set<string>();
    if (ticket.creadoPorId && ticket.creadoPorId !== autorId) recipientIds.add(ticket.creadoPorId);
    if (ticket.asignadoAId && ticket.asignadoAId !== autorId) recipientIds.add(ticket.asignadoAId);

    if (recipientIds.size === 0) return;

    const notifications = Array.from(recipientIds).map((userId) => ({
      userId,
      type: "COMMENT",
      title: `${autorName} comento en "${ticketTitle}"`,
      detail: texto.length > 120 ? texto.slice(0, 120) + "..." : texto,
      ticketId,
    }));

    await this.db.notification.createMany({ data: notifications });

    for (const n of notifications) {
      broadcastToUser(n.userId, {
        type: n.type,
        title: n.title,
        detail: n.detail,
        ticketId: n.ticketId,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  async notifyTicketAssigned(
    ticketId: string,
    ticketTitle: string,
    asignadoAId: string,
    asignadoBy: string
  ) {
    const notif = await this.db.notification.create({
      data: {
        userId: asignadoAId,
        type: "ASSIGNED",
        title: `Se te asigno el ticket "${ticketTitle}"`,
        detail: `Asignado por ${asignadoBy}`,
        ticketId,
      },
    });
    broadcastToUser(asignadoAId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
  }

  async notifyTicketStatusChanged(
    ticketId: string,
    ticketTitle: string,
    newStatus: string,
    changedBy: string,
    targetUserId: string
  ) {
    const statusLabels: Record<string, string> = {
      ABIERTO: "Abierto",
      EN_SEGUIMIENTO: "En seguimiento",
      CERRADO: "Cerrado",
    };
    const notif = await this.db.notification.create({
      data: {
        userId: targetUserId,
        type: "TICKET_UPDATED",
        title: `Ticket "${ticketTitle}" cambio de estado`,
        detail: `Nuevo estado: ${statusLabels[newStatus] ?? newStatus} — por ${changedBy}`,
        ticketId,
      },
    });
    broadcastToUser(targetUserId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
  }
}