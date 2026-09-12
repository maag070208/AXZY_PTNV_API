import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import {
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type { ReportFilters, ReportRow } from "../models/entity/report.entity";

const includeReport = {
  items: { include: { device: true } },
  responsable: { select: { name: true } },
};

export class ReportService {
  constructor(private readonly db = prismaClient) {}

  private buildWhere(filters: ReportFilters): Prisma.CartaResponsivaWhereInput {
    const where: Prisma.CartaResponsivaWhereInput = {};
    if (filters.start) where.fecha = { ...(where.fecha as any), gte: new Date(filters.start) };
    if (filters.end) where.fecha = { ...(where.fecha as any), lte: new Date(filters.end + "T23:59:59") };
    if (filters.department) where.departamento = filters.department;
    if (filters.employee) {
      where.OR = [
        { responsable: { name: { contains: filters.employee, mode: "insensitive" } } },
        { numeroEmpleado: { contains: filters.employee, mode: "insensitive" } },
      ];
    }
    return where;
  }

  private toRows(cartas: Awaited<ReturnType<typeof this.fetchCartas>>): ReportRow[] {
    return cartas.flatMap((c) =>
      c.items.map((it) => ({
        id: c.id,
        fecha: c.fecha,
        document_code: c.consecutive,
        employee_no: c.numeroEmpleado,
        responsible: c.responsable?.name ?? "",
        department: c.departamento,
        subarea: null,
        area_boss: c.areaBoss ?? "",
        delivery_by: c.deliveryBy,
        return_date: c.returnDate,
        returned_by: c.returnedBy ?? "",
        return_condition: c.returnCondition ?? "",
        asset_code: it.controlActivos,
        description: it.descripcion,
        cantidad: c.items.length,
        brand: it.marca,
        model: it.modelo,
        serial: it.numeroSerie,
        equipment_name: it.nombreEquipo,
        estado: c.returnDate ? "DEVUELTO" : "ASIGNADO",
      }))
    );
  }

  private fetchCartas(where: Prisma.CartaResponsivaWhereInput) {
    return this.db.cartaResponsiva.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      include: includeReport,
    });
  }

  async getReport(filters: ReportFilters): Promise<ReportRow[]> {
    const cartas = await this.fetchCartas(this.buildWhere(filters));
    return this.toRows(cartas);
  }

  async getReportTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<ReportRow>> {
    const { filters } = params;
    const cartas = await this.fetchCartas(
      this.buildWhere({
        start: typeof filters.start === "string" ? filters.start : undefined,
        end: typeof filters.end === "string" ? filters.end : undefined,
        department: typeof filters.department === "string" ? filters.department : undefined,
        employee: typeof filters.employee === "string" ? filters.employee : undefined,
      })
    );

    let rows = this.toRows(cartas);

    const sorters: Record<string, (a: ReportRow, b: ReportRow) => number> = {
      fecha: (a, b) => a.fecha.getTime() - b.fecha.getTime(),
      document_code: (a, b) => a.document_code.localeCompare(b.document_code),
      employee_no: (a, b) => (a.employee_no ?? "").localeCompare(b.employee_no ?? ""),
      responsible: (a, b) => a.responsible.localeCompare(b.responsible),
      department: (a, b) => a.department.localeCompare(b.department),
      asset_code: (a, b) => a.asset_code.localeCompare(b.asset_code),
      description: (a, b) => a.description.localeCompare(b.description),
      cantidad: (a, b) => a.cantidad - b.cantidad,
      estado: (a, b) => a.estado.localeCompare(b.estado),
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
        fmtDate(r.fecha),
        r.document_code,
        r.employee_no ?? "",
        r.responsible,
        r.department,
        r.subarea ?? "",
        r.area_boss ?? "",
        r.delivery_by,
        r.asset_code,
        r.description,
        String(r.cantidad),
        r.brand ?? "",
        r.model ?? "",
        r.serial ?? "",
        r.equipment_name ?? "",
        r.estado,
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