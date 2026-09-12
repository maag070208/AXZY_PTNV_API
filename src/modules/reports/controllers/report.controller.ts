import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { ReportService } from "../services/report.service";
import { AssignmentService } from "../services/assignment.service";
import type { ReportFilters } from "../models/entity/report.entity";

export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly assignmentService: AssignmentService
  ) {}

  private parseFilters(req: Request): ReportFilters {
    return {
      start: typeof req.query.start === "string" ? req.query.start : undefined,
      end: typeof req.query.end === "string" ? req.query.end : undefined,
      department: typeof req.query.department === "string" ? req.query.department : undefined,
      employee: typeof req.query.employee === "string" ? req.query.employee : undefined,
    };
  }

  report = async (req: Request, res: Response) => {
    const filters = this.parseFilters(req);
    const rows = await this.reportService.getReport(filters);
    res.json({ data: rows, total: rows.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.reportService.getReportTable(params);
    res.json(paginatedTable(params, data, total));
  };

  csv = async (req: Request, res: Response) => {
    const filters = this.parseFilters(req);
    const rows = await this.reportService.getReport(filters);
    this.reportService.streamCsv(res, rows);
  };

  asignados = async (_req: Request, res: Response) => {
    const rows = await this.assignmentService.getAsignadosReport();
    res.json({ data: rows, total: rows.length });
  };

  devices = async (_req: Request, res: Response) => {
    const rows = await this.assignmentService.getDevicesReport();
    res.json({ data: rows, total: rows.length });
  };
}