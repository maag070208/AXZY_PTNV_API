import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { dateKeyOf, toUtcDate } from "./workday-rules";

export interface PayrollReviewInput {
  /** Primer día de la semana (`YYYY-MM-DD`, clave natural del cierre). */
  weekStart: string;
  departmentId: string | null;
}

export interface PayrollCloseInput {
  weekStart: string;
  /** Los departamentos que la pantalla revisó: todos deben tener su revisión. */
  departmentIds: (string | null)[];
  /** Fotografía de las cifras al cerrar (totales del reporte). */
  snapshot?: Record<string, unknown>;
}

const personName = { select: { id: true, name: true } } as const;

/**
 * Revisión por departamento y cierre de la pre-nómina semanal.
 *
 * La revisión queda por semana y departamento (`departmentId` null = el grupo
 * sin departamento), con quién y cuándo la hizo y si fue una por una o con
 * «marcar todo» (`bulk`). El cierre es una fila por semana con su fotografía
 * de cifras; reabrir y volver a cerrar actualizan la misma fila y la bitácora
 * (`PAYROLL_*`) conserva el historial completo.
 */
export class PayrollReviewService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Historial de cierres: las últimas `limit` semanas, más reciente primero. */
  async listClosures(limit = 52) {
    const rows = await this.db.payrollWeekClosure.findMany({
      include: { closedBy: personName, reopenedBy: personName },
      orderBy: { weekStart: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      weekStart: dateKeyOf(row.weekStart),
      closed: row.reopenedAt === null,
      closedAt: row.closedAt,
      closedBy: row.closedBy,
      reopenedAt: row.reopenedAt,
      reopenedBy: row.reopenedBy,
      snapshot: row.snapshot,
    }));
  }

  /** Estado de la semana: el cierre (si existe) y las revisiones vigentes. */
  async state(weekStart: string) {
    const week = toUtcDate(weekStart);
    const [closure, reviews] = await Promise.all([
      this.db.payrollWeekClosure.findUnique({
        where: { weekStart: week },
        include: { closedBy: personName, reopenedBy: personName },
      }),
      this.db.payrollDepartmentReview.findMany({
        where: { weekStart: week },
        include: { reviewedBy: personName },
        orderBy: { reviewedAt: "asc" },
      }),
    ]);

    return {
      weekStart,
      closed: closure !== null && closure.reopenedAt === null,
      closure: closure
        ? {
            closedAt: closure.closedAt,
            closedBy: closure.closedBy,
            reopenedAt: closure.reopenedAt,
            reopenedBy: closure.reopenedBy,
            snapshot: closure.snapshot,
          }
        : null,
      reviews: reviews.map((review) => ({
        departmentId: review.departmentId,
        bulk: review.bulk,
        reviewedAt: review.reviewedAt,
        reviewedBy: review.reviewedBy,
      })),
    };
  }

  /** Marca o desmarca un departamento (revisión individual: `bulk = false`). */
  async setReviewed(actorId: string | undefined, input: PayrollReviewInput & { reviewed: boolean }) {
    const week = toUtcDate(input.weekStart);
    const key = `${input.weekStart}|${input.departmentId ?? ""}`;
    const existing = await this.db.payrollDepartmentReview.findFirst({
      where: { weekStart: week, departmentId: input.departmentId },
    });

    if (input.reviewed) {
      if (existing) {
        await this.db.payrollDepartmentReview.update({
          where: { id: existing.id },
          data: { bulk: false, reviewedById: actorId ?? null, reviewedAt: new Date() },
        });
      } else {
        await this.db.payrollDepartmentReview.create({
          data: { weekStart: week, departmentId: input.departmentId, bulk: false, reviewedById: actorId ?? null },
        });
      }
    } else if (existing) {
      await this.db.payrollDepartmentReview.delete({ where: { id: existing.id } });
    }

    await this.audit?.({
      action: input.reviewed ? "PAYROLL_DEPARTMENT_REVIEWED" : "PAYROLL_DEPARTMENT_UNREVIEWED",
      entityType: "PayrollDepartmentReview",
      entityId: key,
      userId: actorId,
      newState: { reviewed: input.reviewed },
    });

    return this.state(input.weekStart);
  }

  /** «Marcar todo como revisado»: crea las revisiones que falten (`bulk = true`). */
  async reviewAll(actorId: string | undefined, input: { weekStart: string; departmentIds: (string | null)[] }) {
    const week = toUtcDate(input.weekStart);
    const existing = await this.db.payrollDepartmentReview.findMany({
      where: { weekStart: week },
      select: { departmentId: true },
    });
    const reviewed = new Set(existing.map((row) => row.departmentId ?? ""));
    const missing = [...new Set(input.departmentIds.map((id) => id ?? ""))].filter((key) => !reviewed.has(key));

    if (missing.length > 0) {
      await this.db.payrollDepartmentReview.createMany({
        data: missing.map((key) => ({
          weekStart: week,
          departmentId: key === "" ? null : key,
          bulk: true,
          reviewedById: actorId ?? null,
        })),
      });
    }

    await this.audit?.({
      action: "PAYROLL_DEPARTMENT_REVIEWED",
      entityType: "PayrollDepartmentReview",
      entityId: input.weekStart,
      userId: actorId,
      metadata: { bulk: true, created: missing.length, total: input.departmentIds.length },
    });

    return this.state(input.weekStart);
  }

  /** Cierra la semana: exige que todos los departamentos estén revisados. */
  async close(actorId: string | undefined, input: PayrollCloseInput) {
    const week = toUtcDate(input.weekStart);
    const reviews = await this.db.payrollDepartmentReview.findMany({
      where: { weekStart: week },
      select: { departmentId: true },
    });
    const reviewed = new Set(reviews.map((row) => row.departmentId ?? ""));
    const missing = input.departmentIds.filter((id) => !reviewed.has(id ?? ""));
    if (missing.length > 0) {
      throw new HttpError(409, "DEPARTMENTS_PENDING_REVIEW", { count: missing.length });
    }

    const snapshot = input.snapshot as Prisma.InputJsonValue | undefined;
    await this.db.payrollWeekClosure.upsert({
      where: { weekStart: week },
      create: {
        weekStart: week,
        closedById: actorId ?? null,
        snapshot,
      },
      update: {
        closedById: actorId ?? null,
        closedAt: new Date(),
        reopenedById: null,
        reopenedAt: null,
        snapshot,
      },
    });

    await this.audit?.({
      action: "PAYROLL_WEEK_CLOSED",
      entityType: "PayrollWeekClosure",
      entityId: input.weekStart,
      userId: actorId,
      newState: { departments: input.departmentIds.length },
    });

    return this.state(input.weekStart);
  }

  /** Reabre una semana cerrada (la fila queda con el sello de reapertura). */
  async reopen(actorId: string | undefined, input: { weekStart: string }) {
    const week = toUtcDate(input.weekStart);
    const closure = await this.db.payrollWeekClosure.findUnique({ where: { weekStart: week } });
    if (!closure || closure.reopenedAt !== null) {
      throw new HttpError(409, "PAYROLL_NOT_CLOSED", { week: dateKeyOf(week) });
    }

    await this.db.payrollWeekClosure.update({
      where: { weekStart: week },
      data: { reopenedById: actorId ?? null, reopenedAt: new Date() },
    });

    await this.audit?.({
      action: "PAYROLL_WEEK_REOPENED",
      entityType: "PayrollWeekClosure",
      entityId: input.weekStart,
      userId: actorId,
    });

    return this.state(input.weekStart);
  }
}
