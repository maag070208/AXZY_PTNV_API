import { Response } from "express";
import { prismaClient } from "@core/config/database";
import type { ITDataTableFetchParams, ITDataTableResponse } from "@core/utils/table";
import type { ReportFilters, ReportRow } from "../models/entity/report.entity";

export class ReportService {
  constructor(private readonly db = prismaClient) {}

  private buildWhere(filters: ReportFilters) {
    const where: Record<string, unknown> = {};
    if (filters.start) where.date = { ...(where.date as any), gte: new Date(filters.start) };
    if (filters.end)
      where.date = { ...(where.date as any), lte: new Date(filters.end + "T23:59:59") };
    if (filters.department) where.department = { is: { name: { contains: filters.department, mode: "insensitive" } } };
    if (filters.employee) {
      where.custodian = { name: { contains: filters.employee, mode: "insensitive" } };
    }
    return where;
  }

  private async fetchLoans(where: Record<string, unknown>) {
    return this.db.loan.findMany({
      where: where as any,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        custodian: { select: { name: true, employeeNumber: true } },
        department: { select: { name: true } },
        items: {
          include: {
            device: true,
            units: { include: { deviceUnit: true } },
          },
        },
      },
    });
  }

  private toRows(
    loans: Awaited<ReturnType<typeof this.fetchLoans>>
  ): ReportRow[] {
    return loans.flatMap((p) =>
      p.items.flatMap((d) => {
        const rows = d.units.length > 0 ? d.units : [{ deviceUnit: null } as any];
        return rows.map((u) => ({
          id: p.id,
          date: p.date,
          document_code: p.number,
          employee_no: p.custodian?.employeeNumber ?? null,
          responsible: p.custodian?.name ?? "",
          department: p.department?.name ?? "",
          subarea: null,
          area_boss: null,
          delivery_by: "",
          return_date: p.status === "RETURNED" || p.status === "CANCELLED" ? p.date : null,
          returned_by: null,
          return_condition: null,
          asset_code: u.deviceUnit?.assetTag ?? "",
          description: d.device.name,
          quantity: d.quantity,
          brand: d.device.brand,
          model: d.device.model,
          serial: u.deviceUnit?.serialNumber ?? null,
          equipment_name: u.deviceUnit?.hostname ?? null,
          status: p.status === "RETURNED" ? "RETURNED" : "ASSIGNED",
        }));
      })
    );
  }

  async getReport(filters: ReportFilters): Promise<ReportRow[]> {
    const loans = await this.fetchLoans(this.buildWhere(filters));
    return this.toRows(loans);
  }

  async getReportTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<ReportRow>> {
    const { filters } = params;
    const loans = await this.fetchLoans(
      this.buildWhere({
        start: typeof filters.start === "string" ? filters.start : undefined,
        end: typeof filters.end === "string" ? filters.end : undefined,
        department: typeof filters.department === "string" ? filters.department : undefined,
        employee: typeof filters.employee === "string" ? filters.employee : undefined,
      })
    );

    let rows = this.toRows(loans);

    const sorters: Record<string, (a: ReportRow, b: ReportRow) => number> = {
      date: (a, b) => a.date.getTime() - b.date.getTime(),
      document_code: (a, b) => a.document_code.localeCompare(b.document_code),
      employee_no: (a, b) => (a.employee_no ?? "").localeCompare(b.employee_no ?? ""),
      responsible: (a, b) => a.responsible.localeCompare(b.responsible),
      department: (a, b) => a.department.localeCompare(b.department),
      asset_code: (a, b) => a.asset_code.localeCompare(b.asset_code),
      description: (a, b) => a.description.localeCompare(b.description),
      quantity: (a, b) => a.quantity - b.quantity,
      status: (a, b) => a.status.localeCompare(b.status),
    };

    if (params.sort && sorters[params.sort.key]) {
      const cmp = sorters[params.sort.key];
      rows = [...rows].sort(params.sort.direction === "asc" ? cmp : (a, b) => cmp(b, a));
    }

    const total = rows.length;
    const start = (params.page - 1) * params.limit;
    return { data: rows.slice(start, start + params.limit), total };
  }

  streamCsv(res: Response, rows: ReportRow[]) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="reporte_entregas.csv"');
    res.write(CSV_HEADERS.join(",") + "\n");
    for (const r of rows) {
      const line = [
        fmtDate(r.date),
        r.document_code,
        r.employee_no ?? "",
        r.responsible,
        r.department,
        r.subarea ?? "",
        r.area_boss ?? "",
        r.delivery_by,
        r.asset_code,
        r.description,
        String(r.quantity),
        r.brand ?? "",
        r.model ?? "",
        r.serial ?? "",
        r.equipment_name ?? "",
        r.status,
        fmtDate(r.return_date),
        r.returned_by ?? "",
        r.return_condition ?? "",
      ]
        .map(csvEscape)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  }
}

const CSV_HEADERS = [
  "Fecha",
  "Documento",
  "No. empleado",
  "Responsable",
  "Departamento",
  "Subarea",
  "Jefe de area",
  "Entrega",
  "Activo",
  "Descripcion",
  "Cantidad",
  "Marca",
  "Modelo",
  "Serie",
  "Nombre equipo",
  "Estado",
  "Fecha devolucion",
  "Resguardo",
  "Condicion devolucion",
];

const csvEscape = (v: string): string => {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

const fmtDate = (d: Date | null): string => {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${yy}-${mm}-${dd}`;
};