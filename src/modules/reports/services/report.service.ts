import { t } from "@core/i18n";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { parseDateFilter, resolveTimezone } from "@core/utils/timezone";
import type { ReportFilters, ReportRow } from "../models/entity/report.entity";

/** Estado de una línea del reporte, derivado del ÍTEM de préstamo. */
export type DeliveryStatus = "RETURNED" | "PARTIAL" | "ACTIVE";

/**
 * Estado por ítem (no por carta): un préstamo puede estar devuelto a medias si
 * sólo se devolvió parte de sus equipos.
 */
export const deliveryStatusOf = (returnedQuantity: number, quantity: number): DeliveryStatus => {
  if (returnedQuantity > 0 && returnedQuantity >= quantity) return "RETURNED";
  if (returnedQuantity > 0) return "PARTIAL";
  return "ACTIVE";
};

/** Un préstamo CANCELLED nunca fue una entrega: no va a filas ni a KPIs. */
const NOT_CANCELLED = { status: { not: "CANCELLED" as const } };

const loanItemInclude = {
  number: true,
  date: true,
  custodian: { select: { name: true, employeeNumber: true } },
  department: { select: { name: true } },
  subarea: { select: { name: true } },
  movement: { select: { createdBy: { select: { name: true } } } },
} as const;

/** `LoanItem` + todo lo necesario para pintarlo y para saber si se devolvió. */
const itemInclude = {
  device: { select: { id: true, name: true, brand: true, model: true } },
  units: { select: { deviceUnit: { select: { assetTag: true, serialNumber: true, hostname: true } } } },
  returnItems: {
    orderBy: { id: "asc" as const },
    select: {
      condition: true,
      loanReturn: { select: { number: true, date: true, custodian: { select: { name: true } } } },
    },
  },
} as const;

/** `LoanItem` con las relaciones necesarias para pintar la fila. */
const itemIncludeFull = { loan: { select: loanItemInclude }, ...itemInclude };
type LoanItemRow = Prisma.LoanItemGetPayload<{ include: typeof itemIncludeFull }>;

/** Allowlist de orden de la tabla de entregas (todo ordenable en Prisma). */
const REPORT_ORDER_BY: Record<
  string,
  string | ((direction: "asc" | "desc") => unknown)
> = {
  date: (direction) => ({ loan: { date: direction } }),
  document_code: (direction) => ({ loan: { number: direction } }),
  employee_no: (direction) => ({ loan: { custodian: { employeeNumber: direction } } }),
  responsible: (direction) => ({ loan: { custodian: { name: direction } } }),
  department: (direction) => ({ loan: { department: { name: direction } } }),
  subarea: (direction) => ({ loan: { subarea: { name: direction } } }),
  description: (direction) => ({ device: { name: direction } }),
  brand: (direction) => ({ device: { brand: direction } }),
  model: (direction) => ({ device: { model: direction } }),
  quantity: "quantity",
};

/**
 * Orden estable: fecha de entrega descendente con desempate por id, que es
 * único y por eso la paginación server-side siempre es consistente.
 */
const REPORT_FALLBACK_ORDER_BY = [{ loan: { date: "desc" } }, { id: "asc" }];

export class ReportService {
  constructor(private readonly db = prismaClient) {}

  /**
   * Filtros del reporte de entregas sobre `LoanItem`. El borde del día lo
   * resuelve `parseDateFilter` en la zona del reporte: `new Date(end +
   * "T23:59:59")` dependía del reloj del proceso y en un contenedor en UTC
   * recortaba (o dejaba pasar) la última hora del día.
   */
  private buildWhere(filters: ReportFilters) {
    const tz = resolveTimezone();
    const loan: Record<string, unknown> = { ...NOT_CANCELLED };

    const start = parseDateFilter(filters.start, tz, "start");
    const end = parseDateFilter(filters.end, tz, "end");
    if (start || end) loan.date = { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };

    if (filters.department) loan.department = { name: ci(filters.department) };
    if (filters.employee) loan.custodian = { name: ci(filters.employee) };

    return { loan };
  }

  private async fetchItems(
    where: Record<string, unknown>,
    page?: { skip: number; take: number; orderBy: unknown[] }
  ): Promise<LoanItemRow[]> {
    return this.db.loanItem.findMany({
      where: where as never,
      include: itemIncludeFull,
      orderBy: (page ? page.orderBy : REPORT_FALLBACK_ORDER_BY) as never,
      skip: page?.skip,
      take: page?.take,
    });
  }

  /**
   * UNA fila por `LoanItem`, con `quantity` una sola vez. Antes se emitía una
   * fila por unidad física y se repetía `d.quantity` en cada una, así que un
   * préstamo de 3 equipos de un mismo tipo contaba 9.
   *
   * Como la fila ya no es la de una unidad, los campos de unidad (activo fijo,
   * serie, nombre de equipo) se listan separados por coma cuando el ítem cubre
   * varias: es la información real del ítem, no un invento.
   */
  private toRows(items: LoanItemRow[]): ReportRow[] {
    return items.map((item) => {
      const loan = item.loan;
      // Primera devolución real que contiene este ítem: la fecha y el folio del
      // préstamo no son la devolución.
      const returned = item.returnItems[0];
      const ret = returned?.loanReturn ?? null;

      return {
        id: item.id,
        date: loan.date,
        document_code: loan.number,
        employee_no: loan.custodian?.employeeNumber ?? null,
        responsible: loan.custodian?.name ?? "",
        department: loan.department?.name ?? "",
        subarea: loan.subarea?.name ?? null,
        // Sin origen en el modelo: el jefe de área no se registra en la carta.
        area_boss: null,
        delivery_by: loan.movement?.createdBy.name ?? "",
        return_date: ret?.date ?? null,
        returned_by: ret?.custodian?.name ?? null,
        return_condition: returned?.condition ?? null,
        asset_code: item.units.map((u) => u.deviceUnit.assetTag).join(", "),
        description: item.device.name,
        quantity: item.quantity,
        brand: item.device.brand,
        model: item.device.model,
        serial: item.units.map((u) => u.deviceUnit.serialNumber ?? "").filter(Boolean).join(", ") || null,
        equipment_name:
          item.units.map((u) => u.deviceUnit.hostname ?? "").filter(Boolean).join(", ") || null,
        status: deliveryStatusOf(item.returnedQuantity, item.quantity),
      };
    });
  }

  async getReport(filters: ReportFilters): Promise<ReportRow[]> {
    return this.toRows(await this.fetchItems(this.buildWhere(filters)));
  }

  /**
   * Página de la tabla de entregas. La fila del reporte ES un `LoanItem`, así
   * que se pagina sobre `loan_items` con `skip`/`take` y `orderBy` de Prisma:
   * nada se materializa ni se ordena en memoria.
   */
  async getReportTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<ReportRow>> {
    const { filters } = params;
    const where = this.buildWhere({
      start: typeof filters.start === "string" ? filters.start : undefined,
      end: typeof filters.end === "string" ? filters.end : undefined,
      department: typeof filters.department === "string" ? filters.department : undefined,
      employee: typeof filters.employee === "string" ? filters.employee : undefined,
    });

    const [items, total] = await Promise.all([
      this.fetchItems(where, {
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: orderByOf(params.sort, REPORT_ORDER_BY, REPORT_FALLBACK_ORDER_BY),
      }),
      this.db.loanItem.count({ where: where as never }),
    ]);

    return { data: this.toRows(items), total };
  }

  streamCsv(res: Response, rows: ReportRow[]) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${t("exports.deliveryReport.filename")}"`
    );
    res.write(
      CSV_COLUMNS.map((column) => csvEscape(t(`exports.deliveryReport.${column}`))).join(",") + "\n"
    );
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

// Orden de las columnas del CSV (llaves de `exports.deliveryReport`).
const CSV_COLUMNS = [
  "date",
  "document",
  "employeeNumber",
  "custodian",
  "department",
  "subarea",
  "areaHead",
  "deliveredBy",
  "assetTag",
  "description",
  "quantity",
  "brand",
  "model",
  "serialNumber",
  "hostname",
  "status",
  "returnDate",
  "returnedBy",
  "returnCondition",
] as const;

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
