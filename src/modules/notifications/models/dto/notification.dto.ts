import { z } from "zod";
import { registry } from "@core/swagger/registry";

export const NotificationSchema = registry.register(
  "Notification",
  z
    .object({
      id: z.string(),
      userId: z.string(),
      type: z.string(),
      title: z.string(),
      detail: z.string().nullable(),
      ticketId: z.string().nullable(),
      read: z.boolean(),
      createdAt: z.string(),
    })
    .openapi("Notification")
);

export const NotificationListResponseSchema = z
  .object({ data: z.array(NotificationSchema), total: z.number() })
  .openapi("NotificationListResponse");
registry.register("NotificationListResponse", NotificationListResponseSchema);

export const UnreadCountSchema = registry.register(
  "UnreadCount",
  z.object({ count: z.number() }).openapi("UnreadCount")
);