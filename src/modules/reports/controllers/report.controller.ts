import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { ReportService } from "../services/report.service";
import { AssignmentService } from "../services/assignment.service";
import { PeriodSummaryService } from "../services/period-summary.service";
import { PeriodSummaryQuerySchema } from "../models/dto/report.dto";
import type { ReportFilters } from "../models/entity/report.entity";

export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly assignmentService: AssignmentService,
    private readonly periodSummaryService: PeriodSummaryService
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

  // --- Instantáneas con tabla server-side (paginación + KPIs del filtro) ---

  assigned = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total, stats } = await this.assignmentService.getAssignedDevicesReport(params);
    res.json({ ...paginatedTable(params, data, total), stats });
  };

  assignedExport = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total, stats, truncated } = await this.assignmentService.getAssignedDevicesExport(params);
    res.json({ data, total, stats, truncated });
  };

  devices = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total, stats } = await this.assignmentService.getDevicesReport(params);
    res.json({ ...paginatedTable(params, data, total), stats });
  };

  devicesExport = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total, stats, truncated } = await this.assignmentService.getDevicesExport(params);
    res.json({ data, total, stats, truncated });
  };

  // --- Reporte de periodo (resumen y detalle que alimenta el PDF) ---

  periodSummary = async (req: Request, res: Response) => {
    const query = PeriodSummaryQuerySchema.parse(req.body);
    res.json(await this.periodSummaryService.summary(query));
  };

  periodDetail = async (req: Request, res: Response) => {
    const query = PeriodSummaryQuerySchema.parse(req.body);
    res.json(await this.periodSummaryService.detail(query));
  };

  /** Tabla server-side del detalle: mismo `where` que el PDF, pero paginado. */
  periodDeliveries = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.periodSummaryService.periodDeliveries(params);
    res.json(paginatedTable(params, data, total));
  };
}
