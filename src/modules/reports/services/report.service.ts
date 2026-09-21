import { Response } from "express";
import { prismaClient } from "@core/config/database";
import type { ITDataTableFetchParams, ITDataTableResponse } from "@core/utils/table";
import type { ReportFilters, ReportRow } from "../models/entity/report.entity";

export class ReportService {
  constructor(private readonly db = prismaClient) {}

  private buildWhere(filters: ReportFilters) {
    const where: Record<string, unknown> = {};
    if (filters.start) where.fecha = { ...(where.fecha as any), gte: new Date(filters.start) };
    if (filters.end)
      where.fecha = { ...(where.fecha as any), lte: new Date(filters.end + "T23:59:59") };
    if (filters.department) where.departamento = { is: { name: { contains: filters.department, mode: "insensitive" } } };
    if (filters.employee) {
      where.responsable = { name: { contains: filters.employee, mode: "insensitive" } };
    }
    return where;
  }

  private async fetchPrestamos(where: Record<string, unknown>) {
    return this.db.prestamo.findMany({
      where: where as any,
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      include: {
        responsable: { select: { name: true, numeroEmpleado: true } },
        departamento: { select: { name: true } },
        detalles: {
          include: {
            dispositivo: true,
            unidades: { include: { unidadFisica: true } },
          },
        },
      },
    });
  }

  private toRows(
    prestamos: Awaited<ReturnType<typeof this.fetchPrestamos>>
  ): ReportRow[] {
    return prestamos.flatMap((p) =>
      p.detalles.flatMap((d) => {
        const rows = d.unidades.length > 0 ? d.unidades : [{ unidadFisica: null } as any];
        return rows.map((u) => ({
          id: p.id,
          fecha: p.fecha,
          document_code: p.consecutivo,
          employee_no: p.responsable?.numeroEmpleado ?? null,
          responsible: p.responsable?.name ?? "",
          department: p.departamento?.name ?? "",
          subarea: null,
          area_boss: null,
          delivery_by: "",
          return_date: p.status === "DEVUELTO" || p.status === "CANCELADO" ? p.fecha : null,
          returned_by: null,
          return_condition: null,
          asset_code: u.unidadFisica?.activoFijo ?? "",
          description: d.dispositivo.nombre,
          cantidad: d.cantidad,
          brand: d.dispositivo.marca,
          model: d.dispositivo.modelo,
          serial: u.unidadFisica?.numeroSerie ?? null,
          equipment_name: u.unidadFisica?.nombreEquipo ?? null,
          estado: p.status === "DEVUELTO" ? "DEVUELTO" : "ASIGNADO",
        }));
      })
    );
  }

  async getReport(filters: ReportFilters): Promise<ReportRow[]> {
    const prestamos = await this.fetchPrestamos(this.buildWhere(filters));
    return this.toRows(prestamos);
  }

  async getReportTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<ReportRow>> {
    const { filters } = params;
    const prestamos = await this.fetchPrestamos(
      this.buildWhere({
        start: typeof filters.start === "string" ? filters.start : undefined,
        end: typeof filters.end === "string" ? filters.end : undefined,
        department: typeof filters.department === "string" ? filters.department : undefined,
        employee: typeof filters.employee === "string" ? filters.employee : undefined,
      })
    );

    let rows = this.toRows(prestamos);

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