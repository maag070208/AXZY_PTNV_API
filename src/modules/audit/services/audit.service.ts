import type { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  AuditLogInput,
  AuditLogListResult,
  ListAuditLogsParams,
} from "../models/entity/audit.entity";

const toJson = (v?: Record<string, any> | null): Prisma.InputJsonValue | undefined =>
  v == null ? undefined : v;

export class AuditService {
  constructor(private readonly db = prismaClient) {}

  // Acepta opcionalmente un cliente de transacción (tx) para que el registro
  // de auditoría quede atado a la misma transacción que la operación que
  // audita: si la transacción falla, el log tampoco se escribe.
  createLog(input: AuditLogInput, client?: Prisma.TransactionClient) {
    const db = client ?? this.db;
    return db.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        userId: input.userId ?? null,
        userName: input.userName ?? null,
        deviceId: input.deviceId ?? null,
        deviceCode: input.deviceCode ?? null,
        previousState: toJson(input.previousState),
        newState: toJson(input.newState),
        metadata: toJson(input.metadata),
      },
    });
  }

  async list(params: ListAuditLogsParams): Promise<AuditLogListResult> {
    const where: any = {};

    if (params.action) where.action = params.action;
    if (params.entityType) where.entityType = params.entityType;
    if (params.userId) where.userId = params.userId;
    if (params.deviceId) where.deviceId = params.deviceId;

    if (params.start || params.end) {
      where.createdAt = {};
      if (params.start) where.createdAt.gte = new Date(params.start);
      if (params.end) where.createdAt.lte = new Date(params.end);
    }

    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const [total, data] = await this.db.$transaction([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async getById(id: string) {
    const log = await this.db.auditLog.findUnique({ where: { id } });
    if (!log) throw new HttpError(404, "AUDIT_LOG_NOT_FOUND");
    return log;
  }
}