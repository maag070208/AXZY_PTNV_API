export interface TicketInput {
  title: string;
  description: string;
  priority?: string;
  categoryId?: string;
  departmentId?: string;
  assignedToId?: string;
}

export interface TicketUpdateInput {
  status?: string;
  priority?: string;
  categoryId?: string | null;
  assignedToId?: string;
  departmentId?: string;
  closedBy?: string;
}

export interface TicketCommentInput {
  text: string;
}

export interface TicketAssignmentInput {
  userId: string;
  title: string;
  description: string;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface TicketAssignmentUpdateInput {
  title?: string;
  description?: string;
  status?: string;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface TicketNotificationPort {
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
}