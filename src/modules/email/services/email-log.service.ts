import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedQuery } from "@core/db/table";
import {
  orderByOf,
  parseTableParams,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

const emailLogSelect = {
  id: true,
  to: true,
  subject: true,
  html: true,
  attachments: true,
  action: true,
  entityType: true,
  entityId: true,
  status: true,
  attempts: true,
  lastError: true,
  nextAttemptAt: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EmailLogStatusValue = "PENDING" | "SENT" | "FAILED" | "CANCELLED";

const VALID_STATUSES: EmailLogStatusValue[] = ["PENDING", "SENT", "FAILED", "CANCELLED"];

/**
 * Lectura de la bitácora de envíos (`email_logs`) para el panel admin.
 * Server-side (post /mail/logs): `{ page, limit, filters, sort }` →
 * `{ data, total }`, con filtros opcionales por status/action/entityId.
 */
export class EmailLogService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async table(body: unknown): Promise<ITDataTableResponse<unknown>> {
    const params = parseTableParams(body);
    const where: Prisma.EmailLogWhereInput = {};

    const status = params.filters.status as string | undefined;
    if (status) {
      if (!(VALID_STATUSES as string[]).includes(status)) {
        throw new HttpError(400, "INVALID_EMAIL_STATUS");
      }
      where.status = status as EmailLogStatusValue;
    }
    const action = params.filters.action as string | undefined;
    if (action) where.action = { contains: action, mode: "insensitive" };
    const entityId = params.filters.entityId as string | undefined;
    if (entityId) where.entityId = entityId;

    const orderBy = orderByOf(
      params.sort,
      {
        createdAt: "createdAt",
        updatedAt: "updatedAt",
        sentAt: "sentAt",
        status: "status",
        to: "to",
      },
      [{ createdAt: "desc" }]
    );

    return paginatedQuery({
      model: this.db.emailLog,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      select: emailLogSelect as never,
      page: params.page,
      limit: params.limit,
    });
  }

  /**
   * Reintento manual: reinicia intentos y vuelve a encolar (PENDING). El
   * worker lo toma en el siguiente ciclo.
   */
  async retry(id: string) {
    const row = await this.db.emailLog.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "EMAIL_LOG_NOT_FOUND");
    if (row.status === "SENT") throw new HttpError(400, "EMAIL_ALREADY_SENT");

    return this.db.emailLog.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
      },
      select: emailLogSelect,
    });
  }

  /** Cancela un correo pendiente sin reintentar. */
  async cancel(id: string) {
    const row = await this.db.emailLog.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "EMAIL_LOG_NOT_FOUND");
    if (row.status === "SENT") throw new HttpError(400, "EMAIL_ALREADY_SENT");

    return this.db.emailLog.update({
      where: { id },
      data: { status: "CANCELLED", nextAttemptAt: null },
      select: emailLogSelect,
    });
  }
}

export type { ITDataTableFetchParams };