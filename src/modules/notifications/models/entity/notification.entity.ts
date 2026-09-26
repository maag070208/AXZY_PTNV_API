export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  detail?: string;
  ticketId?: string;
}

export interface NotifyUserCreatedInput {
  userId: string;
  actorId: string;
  userName: string;
  userEmail?: string | null;
}

export interface NotifyUserDeactivatedInput {
  userId: string;
  actorId: string;
  userName: string;
  reason: string;
  date: string;
}

export interface NotifyDocumentUploadedInput {
  userId: string;
  documentId: string;
  documentName: string;
  typeName: string;
  actorId: string;
  userName: string;
}

export interface NotifyRecipientSummary {
  count: number;
  recipientIds: string[];
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
    authorId: string,
    authorName: string,
    text: string
  ): Promise<void>;
  notifyTicketAssigned(
    ticketId: string,
    ticketTitle: string,
    assignedToId: string,
    assignedBy: string
  ): Promise<void>;
  notifyTicketStatusChanged(
    ticketId: string,
    ticketTitle: string,
    newStatus: string,
    changedBy: string,
    targetUserId: string
  ): Promise<void>;
  notifyUserCreated(input: NotifyUserCreatedInput): Promise<NotifyRecipientSummary>;
  notifyUserDeactivated(input: NotifyUserDeactivatedInput): Promise<NotifyRecipientSummary>;
  notifyDocumentUploaded(input: NotifyDocumentUploadedInput): Promise<NotifyRecipientSummary>;
}