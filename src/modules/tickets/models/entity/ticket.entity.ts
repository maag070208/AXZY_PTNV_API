export interface TicketScope {
  userId?: string;
  role?: string;
  departmentId?: string | null;
}

export interface TicketActor {
  id: string;
  role: string;
  departmentId?: string | null;
}

export interface TicketInput {
  titulo: string;
  descripcion: string;
  priority?: string;
  category?: string;
  departmentId?: string;
  asignadoAId?: string;
}

export interface TicketUpdateInput {
  status?: string;
  priority?: string;
  category?: string;
  asignadoAId?: string;
  departmentId?: string;
  closedBy?: string;
}

export interface TicketCommentInput {
  texto: string;
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