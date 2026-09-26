import type { ReportPeriod } from "@core/utils/timezone";

export interface ReportFilters {
  start?: string;
  end?: string;
  department?: string;
  employee?: string;
}

export interface ReportRow {
  id: string;
  date: Date;
  document_code: string;
  employee_no: string | null;
  responsible: string;
  department: string;
  subarea: string | null;
  area_boss: string | null;
  delivery_by: string;
  return_date: Date | null;
  returned_by: string | null;
  return_condition: string | null;
  asset_code: string;
  description: string;
  quantity: number;
  brand: string | null;
  model: string | null;
  serial: string | null;
  equipment_name: string | null;
  status: string;
}

export type AssignmentSource = "CUSTODY_LETTER" | "MOVEMENT" | "UNKNOWN";

export interface AssignedDeviceRow {
  deviceId: string;
  assetTag: string;
  description: string;
  brand: string;
  model: string;
  type: string;
  custodian: string;
  employeeNumber: string | null;
  department: string | null;
  date: Date | null;
  daysAssigned: number | null;
  source: AssignmentSource;
  folio: string | null;
}

export type DeviceStatus =
  | "AVAILABLE"
  | "ASSIGNED"
  | "DAMAGED"
  | "IN_MAINTENANCE"
  | "RETIRED";

export interface DeviceReportRow {
  deviceId: string;
  assetTag: string;
  description: string;
  brand: string;
  model: string;
  type: string;
  serialNumber: string | null;
  hostname: string | null;
  ip: string | null;
  macAddress: string | null;
  area: string;
  departmentName: string | null;
  status: DeviceStatus;
  batchId: string | null;
  quantity: number;
  custodian: string | null;
  employeeNumber: string | null;
  department: string | null;
  date: Date | null;
  daysAssigned: number | null;
  source: AssignmentSource | null;
  folio: string | null;
}

export interface Assignment {
  custodian: string;
  employeeNumber: string | null;
  department: string | null;
  date: Date | null;
  daysAssigned: number | null;
  source: AssignmentSource;
  folio: string | null;
}

// ---------------------------------------------------------------------------
// Reporte de periodo (resumen + detalle de entregas)
// ---------------------------------------------------------------------------

/** Periodo del reporte: el mismo `DAY | WEEK | MONTH` que usa el reporte de acceso. */
export type PeriodSummaryPeriod = ReportPeriod;

/** Filtros opcionales del reporte de periodo. */
export interface PeriodSummaryFilters {
  typeId: string | null;
  departmentId: string | null;
  custodianId: string | null;
}

/** Cuerpo de `POST /reports/period-summary` y de `.../detail`. */
export interface PeriodSummaryQuery {
  period: PeriodSummaryPeriod;
  /** Día de referencia `YYYY-MM-DD`; el rango se deriva del periodo. */
  date: string;
  timezone?: string;
  typeId?: string;
  departmentId?: string;
  custodianId?: string;
  /** Tope del detalle en `.../detail` (1..2000). */
  detailLimit?: number;
}

/** Ventana `[start, end)` resuelta, en ISO y con `end` EXCLUSIVO. */
export interface PeriodSummaryRange {
  start: string;
  end: string;
  timezone: string;
  period: PeriodSummaryPeriod;
  date: string;
}

/** Totales del periodo; `net` es "delta de responsabilidad". */
export interface PeriodSummaryTotals {
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
  distinctRecipients: number;
  distinctDevices: number;
  distinctLoans: number;
  distinctReturns: number;
  distinctMovements: number;
}

/** Bucket diario local (`YYYY-MM-DD`) dentro de la ventana. */
export interface PeriodBucket {
  day: string;
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
}

/** Acumulado del periodo por dispositivo (lote del catálogo). */
export interface DeviceAggregate {
  deviceId: string;
  description: string;
  typeId: string;
  typeName: string;
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
}

/** Persona que recibió o devolvió equipos dentro del periodo. */
export interface RecipientAggregate {
  userId: string;
  name: string;
  employeeNumber: string | null;
  departmentName: string | null;
  loans: number;
  delivered: number;
  returned: number;
  outstanding: number;
}

export interface PeriodSummary {
  range: PeriodSummaryRange;
  filters: PeriodSummaryFilters;
  totals: PeriodSummaryTotals;
  byPeriod: PeriodBucket[];
  byDevice: DeviceAggregate[];
  recipients: RecipientAggregate[];
}

export interface PeriodSummaryResponse extends PeriodSummary {}

/** Estado de una línea de detalle de entrega (derivado por ítem de préstamo). */
export type DeliveryDetailStatus = "ACTIVE" | "PARTIAL" | "RETURNED";

/** Una línea de detalle: un ítem de préstamo con su devolución real. */
export interface DeliveryDetailRow {
  id: string;
  date: string;
  number: string;
  custodianName: string;
  employeeNumber: string | null;
  departmentName: string | null;
  subareaName: string | null;
  deliveredBy: string;
  deviceId: string;
  description: string;
  typeName: string;
  brand: string;
  model: string;
  quantity: number;
  returnedQuantity: number;
  /** Fecha REAL de la devolución (`LoanReturn.date`), no la del préstamo. */
  returnDate: string | null;
  returnNumber: string | null;
  status: DeliveryDetailStatus;
}

export interface PeriodDetailResponse {
  data: DeliveryDetailRow[];
  total: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// KPIs de las dosinstantáneas (asignados / dispositivos)
// ---------------------------------------------------------------------------

export interface AssignedDevicesStats {
  assigned: number;
  averageDays: number;
  over30: number;
}

export interface DevicesStats {
  total: number;
  available: number;
  assigned: number;
  retired: number;
  over30: number;
  averageDays: number;
}

export interface AssignedDevicesTableResponse {
  data: AssignedDeviceRow[];
  total: number;
  stats: AssignedDevicesStats;
}

export interface DevicesTableResponse {
  data: DeviceReportRow[];
  total: number;
  stats: DevicesStats;
}

/** Universo filtrado sin paginar, con tope explícito y aviso de truncamiento. */
export interface AssignedDevicesExportResponse extends AssignedDevicesTableResponse {
  truncated: boolean;
}

export interface DevicesExportResponse extends DevicesTableResponse {
  truncated: boolean;
}