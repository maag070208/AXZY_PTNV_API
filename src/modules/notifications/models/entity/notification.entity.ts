export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  detail?: string;
  ticketId?: string;
}

export interface NotificationPort {
  createNotification(input: CreateNotificationInput): Promise<unknown>;
  createManyNotifications(inputs: CreateNotificationInput[]): Promise<unknown>;
  listNotifications(userId: string, unreadOnly?: boolean): Promise<unknown[]>;
  getUnreadCount(userId: string): Promise<number>;
  markAsRead(id: string, userId: string): Promise<unknown>;
  markAllAsRead(userId: string): Promise<unknown>;
  deleteNotification(id: string, userId: string): Promise<unknown>;
  notifyTicketComment(
    ticketId: string,
    ticketTitle: string,
    autorId: string,
    autorName: string,
    texto: string
  ): Promise<void>;
  notifyTicketAssigned(
    ticketId: string,
    ticketTitle: string,
    asignadoAId: string,
    asignadoBy: string
  ): Promise<void>;
  notifyTicketStatusChanged(
    ticketId: string,
    ticketTitle: string,
    newStatus: string,
    changedBy: string,
    targetUserId: string
  ): Promise<void>;
}