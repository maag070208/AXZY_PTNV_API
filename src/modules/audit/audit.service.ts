import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  userName?: string;
  deviceId?: string;
  deviceCode?: string;
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  metadata?: Record<string, any>;
}

const toJson = (v?: Record<string, any> | null): Prisma.InputJsonValue | undefined =>
  v == null ? undefined : v;

// Acepta opcionalmente un cliente de transacción (tx) para que el registro de
// auditoría quede atado a la misma transacción que la operación que audita
// (por ejemplo, un movimiento de inventario): si la transacción falla, el
// log tampoco se escribe, evitando historial huérfano o inconsistente.
export const createAuditLog = async (
  input: AuditLogInput,
  client: Prisma.TransactionClient = prismaClient
) => {
  return client.auditLog.create({
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
};

export interface ListAuditLogsParams {
  action?: string;
  entityType?: string;
  userId?: string;
  deviceId?: string;
  start?: string;
  end?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogListResult {
  data: any[];
  total: number;
  page: number;
  limit: number;
}

export const listAuditLogs = async (params: ListAuditLogsParams): Promise<AuditLogListResult> => {
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

  const [total, data] = await prismaClient.$transaction([
    prismaClient.auditLog.count({ where }),
    prismaClient.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return { data, total, page, limit };
};

export const getAuditLogById = async (id: string) => {
  const log = await prismaClient.auditLog.findUnique({
    where: { id },
  });
  if (!log) throw new HttpError(404, "Audit log not found");
  return log;
};
