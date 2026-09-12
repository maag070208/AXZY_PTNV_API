import { z } from "zod";
import { registry } from "@core/swagger/registry";

export const AuditLogSchema = registry.register(
  "AuditLog",
  z.object({
    id: z.string(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    deviceId: z.string().nullable(),
    deviceCode: z.string().nullable(),
    previousState: z.record(z.string(), z.unknown()).nullable().optional(),
    newState: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    createdAt: z.string(),
  })
);

export const AuditLogListResponseSchema = registry.register(
  "AuditLogListResponse",
  z.object({
    data: z.array(AuditLogSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  })
);