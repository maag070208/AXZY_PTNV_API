import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { DisciplinaryReportCreateInput } from "../models/dto/disciplinary-report.dto";
import { disciplinaryReportInclude, type DisciplinaryReportEntity } from "../models/entity/disciplinary-report.entity";

export class DisciplinaryReportService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async table(params: ITDataTableFetchParams) {
    const { filters = {} } = params;
    const q = String(filters.q ?? "").trim();
    const userId = String(filters.userId ?? "").trim();
    const reason = String(filters.reason ?? "").trim();

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (reason) where.reason = reason;

    if (q) {
      const term = `%${q}%`;
      where.OR = [
        { user: { name: { contains: term } } },
        { user: { employeeNumber: { contains: term } } },
        { description: { contains: term } },
      ];
    }

    const orderBy = orderByOf(
      params.sort,
      {
        createdAt: "createdAt",
        incidentDate: "incidentDate",
        reason: "reason",
        user: (direction: "asc" | "desc") => ({ user: { name: direction } }),
      },
      [{ createdAt: "desc" }]
    );

    const [data, total] = await this.db.$transaction([
      this.db.disciplinaryReport.findMany({
        where,
        include: disciplinaryReportInclude,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: orderBy as never[],
      }),
      this.db.disciplinaryReport.count({ where }),
    ]);

    return { data, total };
  }

  async listByEmployee(userId: string): Promise<DisciplinaryReportEntity[]> {
    const disciplinaryReports = await this.db.disciplinaryReport.findMany({
      where: { userId },
      include: disciplinaryReportInclude,
      orderBy: { incidentDate: "desc" },
    });
    if (!disciplinaryReports.length) {
      const user = await this.db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new HttpError(404, "EMPLOYEE_NOT_FOUND");
    }
    return disciplinaryReports;
  }

  async getById(id: string): Promise<DisciplinaryReportEntity> {
    const disciplinaryReport = await this.db.disciplinaryReport.findUnique({
      where: { id },
      include: disciplinaryReportInclude,
    });
    if (!disciplinaryReport) throw new HttpError(404, "DISCIPLINARY_REPORT_NOT_FOUND");
    return disciplinaryReport;
  }

  async create(input: DisciplinaryReportCreateInput, createdById: string): Promise<DisciplinaryReportEntity> {
    const user = await this.db.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new HttpError(404, "EMPLOYEE_NOT_FOUND");

    const incidentDate = new Date(`${input.incidentDate}T12:00:00.000Z`);

    return this.db.disciplinaryReport.create({
      data: {
        userId: input.userId,
        createdById,
        reason: input.reason,
        incidentDate,
        description: input.description,
        sanction: input.sanction?.trim() || null,
      },
      include: disciplinaryReportInclude,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const disciplinaryReport = await this.db.disciplinaryReport.findUnique({ where: { id } });
    if (!disciplinaryReport) throw new HttpError(404, "DISCIPLINARY_REPORT_NOT_FOUND");
    await this.db.disciplinaryReport.delete({ where: { id } });
    return { id };
  }
}