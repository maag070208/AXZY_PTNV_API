import { prismaClient } from "@core/config/database";
import { ci, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import { parseDateFilter, resolveTimezone } from "@core/utils/timezone";
import type {
  AssignedDeviceRow,
  AssignedDevicesExportResponse,
  AssignedDevicesStats,
  AssignedDevicesTableResponse,
  Assignment,
  DeviceReportRow,
  DevicesExportResponse,
  DevicesStats,
  DevicesTableResponse,
  DeviceStatus,
} from "../models/entity/report.entity";

const msPerDay = 1000 * 60 * 60 * 24;

/** Tope del export: el universo filtrado sin paginar, con aviso de truncamiento. */
const EXPORT_LIMIT = 2000;

const LOAN_ACTIVE = { status: { in: ["ACTIVE", "PARTIAL"] } } as const;

/**
 * Estados que puede pedir el filtro de columna. La web muestra `ON_LOAN` como
 * `ASSIGNED` (mismo criterio que el resto del reporte), así que el filtro
 * traduce el vocabulario visible al que guarda el inventario.
 */
const FILTERABLE_STATUS: Record<string, string> = {
  ASSIGNED: "ON_LOAN",
  AVAILABLE: "AVAILABLE",
  DAMAGED: "DAMAGED",
  IN_MAINTENANCE: "IN_MAINTENANCE",
  RETIRED: "RETIRED",
};

const num = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** LoanItemUnit de la asignación vigente: la fila del reporte es esa relación. */
const activeAssignment = (loan: Record<string, unknown>) => ({
  some: { returned: false, loanItem: { loan } },
});

/**
 * Reportes de instantánea (`asignados` / `dispositivos`):_pages_ de tabla
 * server-side. Resuelven `filters` y `sort` en Postgres —antes cada uno traía
 * el universo completo y paginaba en el cliente—.
 *
 * `custodian`, `department`, `folio` y `daysAssigned` no son columnas de
 * `DeviceUnit`: se resuelven con un `where` sobre `loanItemUnits → loanItem →
 * loan`. Lo que NO se puede expresar (ordenar por la relación a-many) queda
 * fuera del allowlist de `orderByOf` y la tabla cae al orden estable, en vez de
 * fingir un orden global que la paginación no puede sostener.
 */
export class AssignmentService {
  constructor(private readonly db = prismaClient) {}

  // Para un conjunto de unidades físicas, resuelve quién las tiene prestadas
  // actualmente (préstamo ACTIVO/PARCIAL vigente).
  async resolveAssignments(deviceUnitIds: string[]): Promise<Map<string, Assignment>> {
    const result = new Map<string, Assignment>();
    if (deviceUnitIds.length === 0) return result;

    const units = await this.db.loanItemUnit.findMany({
      where: {
        deviceUnitId: { in: deviceUnitIds },
        returned: false,
        loanItem: {
          loan: { status: { in: ["ACTIVE", "PARTIAL"] } },
        },
      },
      include: {
        loanItem: {
          include: {
            loan: {
              include: {
                custodian: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    for (const u of units) {
      if (result.has(u.deviceUnitId)) continue;
      const p = u.loanItem.loan;
      result.set(u.deviceUnitId, {
        custodian: p.custodian?.name ?? "—",
        employeeNumber: p.custodian?.employeeNumber ?? null,
        department: p.department?.name ?? null,
        date: p.date,
        daysAssigned: p.date ? Math.floor((Date.now() - p.date.getTime()) / msPerDay) : null,
        source: "CUSTODY_LETTER",
        folio: p.number,
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Asignados
  // ---------------------------------------------------------------------------

  async getAssignedDevicesReport(
    params: ITDataTableFetchParams
  ): Promise<AssignedDevicesTableResponse> {
    const where = this.assignedWhere(params.filters);
    const [total, stats] = await Promise.all([
      this.db.deviceUnit.count({ where }),
      this.assignedStats(where),
    ]);
    const rows = await this.assignedRows(where, orderByOf(params.sort, ASSIGNED_ORDER_BY, FALLBACK_ORDER_BY), {
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
    return { data: rows, total, stats };
  }

  async getAssignedDevicesExport(
    params: ITDataTableFetchParams
  ): Promise<AssignedDevicesExportResponse> {
    const where = this.assignedWhere(params.filters);
    const [total, stats] = await Promise.all([
      this.db.deviceUnit.count({ where }),
      this.assignedStats(where),
    ]);
    const rows = await this.assignedRows(where, orderByOf(params.sort, ASSIGNED_ORDER_BY, FALLBACK_ORDER_BY), {
      take: EXPORT_LIMIT + 1,
    });
    return { data: rows.slice(0, EXPORT_LIMIT), total, stats, truncated: rows.length > EXPORT_LIMIT };
  }

  // ---------------------------------------------------------------------------
  // Dispositivos
  // ---------------------------------------------------------------------------

  async getDevicesReport(params: ITDataTableFetchParams): Promise<DevicesTableResponse> {
    const where = this.devicesWhere(params.filters);
    const [total, stats] = await Promise.all([
      this.db.deviceUnit.count({ where }),
      this.devicesStats(where),
    ]);
    const rows = await this.deviceRows(where, orderByOf(params.sort, DEVICE_ORDER_BY, FALLBACK_ORDER_BY), {
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
    return { data: rows, total, stats };
  }

  async getDevicesExport(params: ITDataTableFetchParams): Promise<DevicesExportResponse> {
    const where = this.devicesWhere(params.filters);
    const [total, stats] = await Promise.all([
      this.db.deviceUnit.count({ where }),
      this.devicesStats(where),
    ]);
    const rows = await this.deviceRows(where, orderByOf(params.sort, DEVICE_ORDER_BY, FALLBACK_ORDER_BY), {
      take: EXPORT_LIMIT + 1,
    });
    return { data: rows.slice(0, EXPORT_LIMIT), total, stats, truncated: rows.length > EXPORT_LIMIT };
  }

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------

  /** `status = ON_LOAN` (el reporte "Asignados" sólo mira lo prestado). */
  private assignedWhere(filters: Record<string, string | number | boolean>) {
    return { status: "ON_LOAN", ...this.commonFilters(filters) } as Record<string, unknown>;
  }

  private devicesWhere(filters: Record<string, string | number | boolean>) {
    const where: Record<string, unknown> = { ...this.commonFilters(filters) };
    const status = str(filters.status);
    if (status && FILTERABLE_STATUS[status.toUpperCase()]) {
      where.status = FILTERABLE_STATUS[status.toUpperCase()];
    }
    return where;
  }

  /** Filtros que comparten las dos instantáneas. */
  private commonFilters(filters: Record<string, string | number | boolean>) {
    const where: Record<string, unknown> = {};
    const tz = resolveTimezone();

    // Todos los filtros que viven en el préstamo VIGENTE se acumulan en un único
    // objeto `loan`: `where.loanItemUnits` sólo admite UNA condición `some`, así
    // que si cada filtro asignara la suya, la última pisaría a las anteriores
    // ("responsable + rango" perdería el responsable). Se asigna al final, y
    // sólo si hay algún filtro de préstamo, para no restringir el catálogo de
    // Dispositivos cuando no se pidió ninguno.
    const loan: Record<string, unknown> = { ...LOAN_ACTIVE };
    let hasLoanFilter = false;

    const q = ci(filters.q);
    if (q) {
      // `q` barre activo fijo, descripción del lote y responsable de la
      // asignación vigente (los tres son texto que el usuarioTeclea).
      where.OR = [
        { assetTag: q },
        { device: { name: q } },
        { loanItemUnits: activeAssignment({ ...LOAN_ACTIVE, custodian: { name: q } }) },
      ];
    }

    const assetTag = ci(filters.assetTag);
    if (assetTag) where.assetTag = assetTag;

    const description = ci(filters.description);
    if (description) where.device = { name: description };

    const type = ci(filters.type);
    if (type) where.device = { ...(where.device as object), type: { name: type } };

    const typeId = str(filters.typeId);
    if (typeId) where.device = { ...(where.device as object), typeId };

    const area = ci(filters.area);
    if (area) where.area = area;

    const custodian = ci(filters.custodian);
    if (custodian) {
      loan.custodian = { name: custodian };
      hasLoanFilter = true;
    }

    const employeeNumber = ci(filters.employeeNumber);
    if (employeeNumber) {
      // Mismo custodio que `custodian`: ambas condiciones se fusionan en lugar
      // de que la segunda sustituya a la primera.
      loan.custodian = { ...(loan.custodian as object), employeeNumber };
      hasLoanFilter = true;
    }

    const department = ci(filters.department);
    if (department) {
      loan.department = { name: department };
      hasLoanFilter = true;
    }

    const departmentName = ci(filters.departmentName);
    if (departmentName) where.department = { name: departmentName };

    const folio = ci(filters.folio);
    if (folio) {
      loan.number = folio;
      hasLoanFilter = true;
    }

    // `date` (corte heredado), `start`/`end` y `daysAssigned` viven en el
    // préstamo vigente: se traducen a un rango sobre `loan.date`. `parseDateFilter`
    // resuelve el borde del día en la zona del reporte (nunca `new Date("…T23:59:59")`).
    const loanDate = this.loanDateFilter(filters, tz);
    if (loanDate) {
      loan.date = { ...(loan.date as object), ...(loanDate.date as object) };
      hasLoanFilter = true;
    }

    if (hasLoanFilter) where.loanItemUnits = activeAssignment(loan);

    return where;
  }

  /**
   * Rango de `loan.date` que imponen los filtros de fecha o de días asignados.
   * `start`/`end` (fin EXCLUSIVO) y el `date` heredado se fusionan con
   * `daysAssigned*` sobre el mismo objeto `date` para que rango y días convivan.
   */
  private loanDateFilter(
    filters: Record<string, string | number | boolean>,
    tz: string
  ): Record<string, unknown> | undefined {
    const start = parseDateFilter(filters.start, tz, "start");
    const end = parseDateFilter(filters.end, tz, "end");
    // Compatibilidad: `date` era el corte de inicio del contrato viejo; `start`
    // (si viene) manda sobre él.
    const legacyFrom = parseDateFilter(filters.date, tz, "start");
    const from = start ?? legacyFrom;

    const date: Record<string, Date> = {};
    if (from) date.gte = from;
    if (end) date.lt = end;

    const min = num(filters.daysAssignedMin) ?? num(filters.daysAssigned);
    const max = num(filters.daysAssignedMax);
    if (min !== undefined) date.lte = new Date(Date.now() - min * msPerDay);
    if (max !== undefined) date.gte = new Date(Date.now() - max * msPerDay);

    if (Object.keys(date).length === 0) return undefined;
    return { date };
  }

  // ---------------------------------------------------------------------------
  // Filas
  // ---------------------------------------------------------------------------

  private async assignedRows(
    where: Record<string, unknown>,
    orderBy: unknown[],
    page: { skip?: number; take: number }
  ): Promise<AssignedDeviceRow[]> {
    const units = await this.db.deviceUnit.findMany({
      where: where as never,
      orderBy: orderBy as never,
      skip: page.skip,
      take: page.take,
      include: { device: { include: { type: true } } },
    });

    const assignments = await this.resolveAssignments(units.map((u) => u.id));

    return units.map((u) => {
      const a = assignments.get(u.id);
      return {
        deviceId: u.id,
        assetTag: u.assetTag,
        description: u.device.name,
        brand: u.device.brand,
        model: u.device.model,
        type: u.device.type?.name ?? "",
        custodian: a?.custodian ?? "—",
        employeeNumber: a?.employeeNumber ?? null,
        department: a?.department ?? null,
        date: a?.date ?? null,
        daysAssigned: a?.daysAssigned ?? null,
        source: a?.source ?? "UNKNOWN",
        folio: a?.folio ?? null,
      };
    });
  }

  private async deviceRows(
    where: Record<string, unknown>,
    orderBy: unknown[],
    page: { skip?: number; take: number }
  ): Promise<DeviceReportRow[]> {
    const units = await this.db.deviceUnit.findMany({
      where: where as never,
      orderBy: orderBy as never,
      skip: page.skip,
      take: page.take,
      include: {
        device: { include: { type: true } },
        department: { select: { id: true, name: true } },
      },
    });

    const loaned = units.filter((u) => u.status === "ON_LOAN").map((u) => u.id);
    const assignments = await this.resolveAssignments(loaned);

    return units.map((u) => {
      const assignment = u.status === "ON_LOAN" ? assignments.get(u.id) ?? null : null;
      return {
        deviceId: u.id,
        assetTag: u.assetTag,
        description: u.device.name,
        brand: u.device.brand,
        model: u.device.model,
        type: u.device.type?.name ?? "",
        serialNumber: u.serialNumber,
        hostname: u.hostname,
        ip: u.ip,
        macAddress: u.macAddress,
        area: u.area,
        departmentName: u.department?.name ?? null,
        // La web (y el resto del reporte) habla en términos de "ASIGNADO";
        // el inventario guarda la unidad como PRESTADO. Se normaliza aquí para
        // no filtrar el estado físico crudo al reporte (mismo criterio que
        // report.service.toRows).
        status: (u.status === "ON_LOAN" ? "ASSIGNED" : u.status) as DeviceStatus,
        batchId: null,
        quantity: 1,
        custodian: assignment?.custodian ?? null,
        employeeNumber: assignment?.employeeNumber ?? null,
        department: assignment?.department ?? null,
        date: assignment?.date ?? null,
        daysAssigned: assignment?.daysAssigned ?? null,
        source: assignment?.source ?? null,
        folio: assignment?.folio ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // KPIs (del conjunto filtrado completo, no de la página cargada)
  // ---------------------------------------------------------------------------

  private async assignedStats(where: Record<string, unknown>): Promise<AssignedDevicesStats> {
    const [assigned, days] = await Promise.all([
      this.db.deviceUnit.count({ where: where as never }),
      this.assignmentDays(where),
    ]);
    return { assigned, averageDays: this.averageDays(days), over30: days.filter((d) => d > 30).length };
  }

  private async devicesStats(where: Record<string, unknown>): Promise<DevicesStats> {
    // Si el usuario ya filtró por estado, ese `where` fija `status` y los
    // conteos por estado tienen que RESPETARLO: sin este cruce, filtrar
    // "disponibles" seguía reportando los asignados de todo el inventario.
    const pinned = typeof where.status === "string" ? where.status : undefined;
    const countBy = (status: string) =>
      pinned !== undefined && pinned !== status
        ? Promise.resolve(0)
        : this.db.deviceUnit.count({ where: { ...where, status } as never });

    const [total, available, assigned, retired, days] = await Promise.all([
      this.db.deviceUnit.count({ where: where as never }),
      countBy("AVAILABLE"),
      countBy("ON_LOAN"),
      countBy("RETIRED"),
      this.assignmentDays(where),
    ]);
    return {
      total,
      available,
      assigned,
      retired,
      over30: days.filter((d) => d > 30).length,
      averageDays: this.averageDays(days),
    };
  }

  /**
   * Días asignados de TODAS las asignaciones vigentes que casan con el filtro.
   * Son una fila por asignación activa (no por unidad del catálogo) y sólo
   * llevan la fecha del préstamo, así que el payload es mínimo; sin esto el
   * promedio y el conteo de +30 dependerían de la página que se está viendo.
   */
  private async assignmentDays(where: Record<string, unknown>): Promise<number[]> {
    const rows = await this.db.loanItemUnit.findMany({
      where: {
        returned: false,
        deviceUnit: { is: where as never },
        loanItem: { loan: { status: { in: ["ACTIVE", "PARTIAL"] } } },
      },
      select: { loanItem: { select: { loan: { select: { date: true } } } } },
    });
    const now = Date.now();
    return rows
      .map((r) => Math.floor((now - r.loanItem.loan.date.getTime()) / msPerDay))
      .filter((d) => d >= 0);
  }

  private averageDays(days: number[]): number {
    if (days.length === 0) return 0;
    return Math.round(days.reduce((acc, d) => acc + d, 0) / days.length);
  }
}

/** Orden estable cuando el `sort` no está en el allowlist. */
const FALLBACK_ORDER_BY = [{ assetTag: "asc" }];

/**
 * Allowlist de orden. Sólo se puede ordenar por lo que es columna o relación
 * a-uno de `DeviceUnit`. `custodian`, `daysAssigned` y `date` viven en el
 * préstamo de una relación a-many, y Prisma no permite ordenar por ella: se
 * ignoran de forma explícita y la tabla conserva el orden estable por activo
 * fijo (que además la paginación server-side necesita como ancla).
 */
type OrderByMap = Record<string, string | ((direction: "asc" | "desc") => unknown)>;

const ASSIGNED_ORDER_BY: OrderByMap = {
  assetTag: "assetTag",
  description: (direction: "asc" | "desc") => ({ device: { name: direction } }),
  type: (direction: "asc" | "desc") => ({ device: { type: { name: direction } } }),
  area: "area",
  status: "status",
};

const DEVICE_ORDER_BY: OrderByMap = {
  ...ASSIGNED_ORDER_BY,
  departmentName: (direction: "asc" | "desc") => ({ department: { name: direction } }),
};
