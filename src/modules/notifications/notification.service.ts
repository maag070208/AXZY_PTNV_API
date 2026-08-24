import { prismaClient } from "@core/config/database";
import { broadcastToUser } from "@core/services/ably";

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  detail?: string;
  ticketId?: string;
}

export const createNotification = async (input: CreateNotificationInput) => {
  return prismaClient.notification.create({ data: input });
};

export const createManyNotifications = async (inputs: CreateNotificationInput[]) => {
  if (inputs.length === 0) return;
  return prismaClient.notification.createMany({ data: inputs });
};

export const listNotifications = async (userId: string, unreadOnly = false) => {
  return prismaClient.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
};

export const getUnreadCount = async (userId: string) => {
  return prismaClient.notification.count({
    where: { userId, read: false },
  });
};

export const markAsRead = async (id: string, userId: string) => {
  return prismaClient.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
};

export const markAllAsRead = async (userId: string) => {
  return prismaClient.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
};

export const deleteNotification = async (id: string, userId: string) => {
  return prismaClient.notification.deleteMany({
    where: { id, userId },
  });
};

// Helper: create notifications for ticket events
export const notifyTicketComment = async (
  ticketId: string,
  ticketTitle: string,
  autorId: string,
  autorName: string,
  texto: string
) => {
  const ticket = await prismaClient.ticket.findUnique({
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
    type: "COMMENT" as const,
    title: `${autorName} comento en "${ticketTitle}"`,
    detail: texto.length > 120 ? texto.slice(0, 120) + "..." : texto,
    ticketId,
  }));

  await prismaClient.notification.createMany({ data: notifications });

  // Send Ably event to each recipient
  for (const n of notifications) {
    broadcastToUser(n.userId, {
      type: n.type,
      title: n.title,
      detail: n.detail,
      ticketId: n.ticketId,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  }
};

export const notifyTicketAssigned = async (
  ticketId: string,
  ticketTitle: string,
  asignadoAId: string,
  asignadoBy: string
) => {
  const notif = await prismaClient.notification.create({
    data: {
      userId: asignadoAId,
      type: "ASSIGNED",
      title: `Se te asigno el ticket "${ticketTitle}"`,
      detail: `Asignado por ${asignadoBy}`,
      ticketId,
    },
  });
  broadcastToUser(asignadoAId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
};

export const notifyTicketStatusChanged = async (
  ticketId: string,
  ticketTitle: string,
  newStatus: string,
  changedBy: string,
  targetUserId: string
) => {
  const statusLabels: Record<string, string> = {
    ABIERTO: "Abierto",
    EN_SEGUIMIENTO: "En seguimiento",
    CERRADO: "Cerrado",
  };
  const notif = await prismaClient.notification.create({
    data: {
      userId: targetUserId,
      type: "TICKET_UPDATED",
      title: `Ticket "${ticketTitle}" cambio de estado`,
      detail: `Nuevo estado: ${statusLabels[newStatus] ?? newStatus} — por ${changedBy}`,
      ticketId,
    },
  });
  broadcastToUser(targetUserId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
};
