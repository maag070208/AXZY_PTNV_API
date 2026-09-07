import { Request, Response } from "express";
import { parseTableParams } from "@core/utils/table";
import * as service from "./report.service";

const parseFilters = (req: Request): service.ReportFilters => ({
  start: typeof req.query.start === "string" ? req.query.start : undefined,
  end: typeof req.query.end === "string" ? req.query.end : undefined,
  department:
    typeof req.query.department === "string" ? req.query.department : undefined,
  employee:
    typeof req.query.employee === "string" ? req.query.employee : undefined,
});

export const report = async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const rows = await service.getReport(filters);
  res.json({ data: rows, total: rows.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.getReportTable(params);
  res.json({ data, total });
};

export const csv = async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const rows = await service.getReport(filters);
  service.streamCsv(res, rows);
};

export const prestamos = async (_req: Request, res: Response) => {
  const rows = await service.getPrestamosReport();
  res.json({ data: rows, total: rows.length });
};

export const devices = async (_req: Request, res: Response) => {
  const rows = await service.getDevicesReport();
  res.json({ data: rows, total: rows.length });
};