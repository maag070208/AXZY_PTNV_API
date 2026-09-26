import { prismaClient } from "@core/config/database";
import { broadcastToUser } from "@core/services/ably";
import { label, systemLanguage, t } from "@core/i18n";
import type {
  CreateNotificationInput,
  NotifyDocumentUploadedInput,
  NotifyRecipientSummary,
  NotifyUserCreatedInput,
  NotifyUserDeactivatedInput,
  NotificationPort,
} from "../models/entity/notification.entity";

const ADMIN_HR_ROLES = ["ADMIN", "HUMAN_RESOURCES"] as const;

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
    authorId: string,
    authorName: string,
    text: string
  ) {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: { createdById: true, assignedToId: true },
    });
    if (!ticket) return;

    const recipientIds = new Set<string>();
    if (ticket.createdById && ticket.createdById !== authorId) recipientIds.add(ticket.createdById);
    if (ticket.assignedToId && ticket.assignedToId !== authorId) recipientIds.add(ticket.assignedToId);

    if (recipientIds.size === 0) return;

    // Se guardan ya traducidas: el idioma es el del sistema, no el del actor.
    const lng = await systemLanguage();
    const notifications = Array.from(recipientIds).map((userId) => ({
      userId,
      type: "COMMENT",
      title: t("notifications.ticketComment", { author: authorName, ticket: ticketTitle }, lng),
      detail: text.length > 120 ? text.slice(0, 120) + "..." : text,
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
    assignedToId: string,
    assignedBy: string
  ) {
    const lng = await systemLanguage();
    const notif = await this.db.notification.create({
      data: {
        userId: assignedToId,
        type: "ASSIGNED",
        title: t("notifications.ticketAssigned", { ticket: ticketTitle }, lng),
        detail: t("notifications.ticketAssignedDetail", { actor: assignedBy }, lng),
        ticketId,
      },
    });
    broadcastToUser(assignedToId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
  }

  async notifyTicketStatusChanged(
    ticketId: string,
    ticketTitle: string,
    newStatus: string,
    changedBy: string,
    targetUserId: string
  ) {
    const lng = await systemLanguage();
    const notif = await this.db.notification.create({
      data: {
        userId: targetUserId,
        type: "TICKET_UPDATED",
        title: t("notifications.ticketStatusChanged", { ticket: ticketTitle }, lng),
        detail: t(
          "notifications.ticketStatusChangedDetail",
          { status: label("ticketStatus", newStatus, lng), actor: changedBy },
          lng
        ),
        ticketId,
      },
    });
    broadcastToUser(targetUserId, { ...notif, createdAt: notif.createdAt.toISOString() }).catch(() => {});
  }

  /**
   * Devuelve los destinatarios con rol ADMIN o RECURSOS_HUMANOS, activos, con
   * email. Excluye al actor para evitar auto-notificarse. Sin cache (R7): se
   * resuelve en cada evento; el volumen es chico y simplifica el manejo de
   * altas/bajas concurrentes.
   */
  private async resolveAdminHrRecipients(
    actorId: string
  ): Promise<{ id: string; email: string; name: string }[]> {
    const recipients = await this.db.user.findMany({
      where: {
        role: { in: [...ADMIN_HR_ROLES] },
        active: true,
        email: { not: null },
        NOT: { id: actorId },
      },
      select: { id: true, email: true, name: true },
    });
    return recipients.filter((r): r is { id: string; email: string; name: string } => !!r.email);
  }

  async notifyUserCreated(input: NotifyUserCreatedInput): Promise<NotifyRecipientSummary> {
    const recipients = await this.resolveAdminHrRecipients(input.actorId);
    if (recipients.length === 0) {
      return { count: 0, recipientIds: [] };
    }

    const actor = await this.db.user.findUnique({
      where: { id: input.actorId },
      select: { name: true },
    });
    const lng = await systemLanguage();
    const actorName = actor?.name ?? t("labels.administrator", {}, lng);

    const userEmail = input.userEmail ?? t("labels.noEmail", {}, lng);

    const notifications: CreateNotificationInput[] = recipients.map((r) => ({
      userId: r.id,
      type: "USER_CREATED",
      title: t("notifications.userCreated", { name: input.userName }, lng),
      detail: t("notifications.userCreatedDetail", { email: userEmail, actor: actorName }, lng),
    }));

    await this.createManyNotifications(notifications);

    for (const n of notifications) {
      broadcastToUser(n.userId, {
        type: n.type,
        title: n.title,
        detail: n.detail,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return { count: notifications.length, recipientIds: recipients.map((r) => r.id) };
  }

  async notifyUserDeactivated(
    input: NotifyUserDeactivatedInput
  ): Promise<NotifyRecipientSummary> {
    const recipients = await this.resolveAdminHrRecipients(input.actorId);
    if (recipients.length === 0) {
      return { count: 0, recipientIds: [] };
    }

    const actor = await this.db.user.findUnique({
      where: { id: input.actorId },
      select: { name: true },
    });
    const lng = await systemLanguage();
    const actorName = actor?.name ?? t("labels.administrator", {}, lng);

    const notifications: CreateNotificationInput[] = recipients.map((r) => ({
      userId: r.id,
      type: "USER_DEACTIVATED",
      title: t("notifications.userDeactivated", { name: input.userName }, lng),
      detail: t("notifications.userDeactivatedDetail", { reason: input.reason, actor: actorName }, lng),
    }));

    await this.createManyNotifications(notifications);

    for (const n of notifications) {
      broadcastToUser(n.userId, {
        type: n.type,
        title: n.title,
        detail: n.detail,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return { count: notifications.length, recipientIds: recipients.map((r) => r.id) };
  }

  async notifyDocumentUploaded(
    input: NotifyDocumentUploadedInput
  ): Promise<NotifyRecipientSummary> {
    const recipients = await this.resolveAdminHrRecipients(input.actorId);
    if (recipients.length === 0) {
      return { count: 0, recipientIds: [] };
    }

    const actor = await this.db.user.findUnique({
      where: { id: input.actorId },
      select: { name: true },
    });
    const lng = await systemLanguage();
    const actorName = actor?.name ?? t("labels.administrator", {}, lng);

    const notifications: CreateNotificationInput[] = recipients.map((r) => ({
      userId: r.id,
      type: "EMPLOYEE_DOC_UPLOADED",
      title: t("notifications.documentUploaded", { name: input.userName }, lng),
      detail: t(
        "notifications.documentUploadedDetail",
        { type: input.typeName, document: input.documentName, actor: actorName },
        lng
      ),
    }));

    await this.createManyNotifications(notifications);

    for (const n of notifications) {
      broadcastToUser(n.userId, {
        type: n.type,
        title: n.title,
        detail: n.detail,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return { count: notifications.length, recipientIds: recipients.map((r) => r.id) };
  }
}