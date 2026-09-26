import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

const ReportRowSchema = registry.register(
  "ReportRow",
  z
    .object({
      id: z.string(),
      date: z.string(),
      document_code: z.string(),
      employee_no: z.string().nullable(),
      responsible: z.string(),
      department: z.string(),
      subarea: z.string().nullable(),
      area_boss: z.string().nullable(),
      delivery_by: z.string(),
      return_date: z.string().nullable(),
      returned_by: z.string().nullable(),
      return_condition: z.string().nullable(),
      asset_code: z.string(),
      description: z.string(),
      quantity: z.number(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      serial: z.string().nullable(),
      equipment_name: z.string().nullable(),
      status: z.string(),
    })
    .openapi("ReportRow")
);

export const ReportListResponseSchema = z
  .object({ data: z.array(ReportRowSchema), total: z.number() })
  .openapi("ReportListResponse");
registry.register("ReportListResponse", ReportListResponseSchema);

export const ReportTableResponseSchema = paginatedTableResponseSchema(ReportRowSchema, "ReportTableResponse");

/**
 * Cuerpo de las tablas server-side. Además de los filtros por columna, `filters`
 * admite `start`/`end` (`YYYY-MM-DD`) para acotar el rango de fecha del reporte.
 */
export const ReportQueryListSchema = TableQuerySchema;

const AssignedDeviceRowSchema = registry.register(
  "AssignedDeviceRow",
  z
    .object({
      deviceId: z.string(),
      assetTag: z.string(),
      description: z.string(),
      brand: z.string(),
      model: z.string(),
      type: z.string(),
      custodian: z.string(),
      employeeNumber: z.string().nullable(),
      department: z.string().nullable(),
      date: z.string().nullable(),
      daysAssigned: z.number().nullable(),
      source: z.string(),
      folio: z.string().nullable(),
    })
    .openapi("AssignedDeviceRow")
);

export const AssignedDevicesStatsSchema = registry.register(
  "AssignedDevicesStats",
  z
    .object({
      assigned: z.number(),
      averageDays: z.number(),
      over30: z.number(),
    })
    .openapi("AssignedDevicesStats")
);

/** Página de asignados: paginación de tabla + KPIs del conjunto filtrado. */
export const AssignedDevicesTableResponseSchema = registry.register(
  "AssignedDevicesTableResponse",
  paginatedTableResponseSchema(AssignedDeviceRowSchema, "AssignedDevicesTablePage").extend({
    stats: AssignedDevicesStatsSchema,
  })
);

/** Export de asignados: universo filtrado, con tope y aviso de truncamiento. */
export const AssignedDevicesExportResponseSchema = registry.register(
  "AssignedDevicesExportResponse",
  z
    .object({
      data: z.array(AssignedDeviceRowSchema),
      total: z.number(),
      stats: AssignedDevicesStatsSchema,
      truncated: z.boolean(),
    })
    .openapi("AssignedDevicesExportResponse")
);

const DeviceReportRowSchema = registry.register(
  "DeviceReportRow",
  z
    .object({
      deviceId: z.string(),
      assetTag: z.string(),
      description: z.string(),
      brand: z.string(),
      model: z.string(),
      type: z.string(),
      serialNumber: z.string().nullable(),
      hostname: z.string().nullable(),
      ip: z.string().nullable(),
      macAddress: z.string().nullable(),
      area: z.string(),
      departmentName: z.string().nullable(),
      status: z.enum(["AVAILABLE", "ASSIGNED", "DAMAGED", "IN_MAINTENANCE", "RETIRED"]),
      batchId: z.string().nullable(),
      quantity: z.number(),
      custodian: z.string().nullable(),
      employeeNumber: z.string().nullable(),
      department: z.string().nullable(),
      date: z.string().nullable(),
      daysAssigned: z.number().nullable(),
      source: z.string().nullable(),
      folio: z.string().nullable(),
    })
    .openapi("DeviceReportRow")
);

export const DevicesStatsSchema = registry.register(
  "DevicesStats",
  z
    .object({
      total: z.number(),
      available: z.number(),
      assigned: z.number(),
      retired: z.number(),
      over30: z.number(),
      averageDays: z.number(),
    })
    .openapi("DevicesStats")
);

/** Página de dispositivos: paginación de tabla + KPIs del conjunto filtrado. */
export const DevicesTableResponseSchema = registry.register(
  "DevicesTableResponse",
  paginatedTableResponseSchema(DeviceReportRowSchema, "DevicesTablePage").extend({
    stats: DevicesStatsSchema,
  })
);

/** Export de dispositivos: universo filtrado, con tope y aviso de truncamiento. */
export const DevicesExportResponseSchema = registry.register(
  "DevicesExportResponse",
  z
    .object({
      data: z.array(DeviceReportRowSchema),
      total: z.number(),
      stats: DevicesStatsSchema,
      truncated: z.boolean(),
    })
    .openapi("DevicesExportResponse")
);

export const ReportFiltersSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  department: z.string().optional(),
  employee: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Reporte de periodo
// ---------------------------------------------------------------------------

const PeriodSummaryRangeSchema = registry.register(
  "PeriodSummaryRange",
  z
    .object({
      start: z.string(),
      end: z.string(),
      timezone: z.string(),
      period: z.enum(["DAY", "WEEK", "MONTH"]),
      date: z.string(),
    })
    .openapi("PeriodSummaryRange")
);

const PeriodSummaryTotalsSchema = registry.register(
  "PeriodSummaryTotals",
  z
    .object({
      delivered: z.number(),
      returned: z.number(),
      admitted: z.number(),
      net: z.number(),
      distinctRecipients: z.number(),
      distinctDevices: z.number(),
      distinctLoans: z.number(),
      distinctReturns: z.number(),
      distinctMovements: z.number(),
    })
    .openapi("PeriodSummaryTotals")
);

const PeriodBucketSchema = registry.register(
  "PeriodBucket",
  z
    .object({
      day: z.string(),
      delivered: z.number(),
      returned: z.number(),
      admitted: z.number(),
      net: z.number(),
    })
    .openapi("PeriodBucket")
);

const DeviceAggregateSchema = registry.register(
  "DeviceAggregate",
  z
    .object({
      deviceId: z.string(),
      description: z.string(),
      typeId: z.string(),
      typeName: z.string(),
      delivered: z.number(),
      returned: z.number(),
      admitted: z.number(),
      net: z.number(),
    })
    .openapi("DeviceAggregate")
);

const RecipientAggregateSchema = registry.register(
  "RecipientAggregate",
  z
    .object({
      userId: z.string(),
      name: z.string(),
      employeeNumber: z.string().nullable(),
      departmentName: z.string().nullable(),
      loans: z.number(),
      delivered: z.number(),
      returned: z.number(),
      outstanding: z.number(),
    })
    .openapi("RecipientAggregate")
);

/** Filtros opcionales del reporte de periodo. */
export const PeriodSummaryQuerySchema = z
  .object({
    period: z.enum(["DAY", "WEEK", "MONTH"]),
    date: z.string(),
    timezone: z.string().optional(),
    typeId: z.string().optional(),
    departmentId: z.string().optional(),
    custodianId: z.string().optional(),
    detailLimit: z.number().int().min(1).max(2000).optional(),
  })
  .openapi("PeriodSummaryQuery");
registry.register("PeriodSummaryQuery", PeriodSummaryQuerySchema);

export const PeriodSummaryResponseSchema = z
  .object({
    range: PeriodSummaryRangeSchema,
    filters: z.object({
      typeId: z.string().nullable(),
      departmentId: z.string().nullable(),
      custodianId: z.string().nullable(),
    }),
    totals: PeriodSummaryTotalsSchema,
    byPeriod: z.array(PeriodBucketSchema),
    byDevice: z.array(DeviceAggregateSchema),
    recipients: z.array(RecipientAggregateSchema),
  })
  .openapi("PeriodSummaryResponse");
registry.register("PeriodSummaryResponse", PeriodSummaryResponseSchema);

const DeliveryDetailRowSchema = registry.register(
  "DeliveryDetailRow",
  z
    .object({
      id: z.string(),
      date: z.string(),
      number: z.string(),
      custodianName: z.string(),
      employeeNumber: z.string().nullable(),
      departmentName: z.string().nullable(),
      subareaName: z.string().nullable(),
      deliveredBy: z.string(),
      deviceId: z.string(),
      description: z.string(),
      typeName: z.string(),
      brand: z.string(),
      model: z.string(),
      quantity: z.number(),
      returnedQuantity: z.number(),
      returnDate: z.string().nullable(),
      returnNumber: z.string().nullable(),
      status: z.enum(["ACTIVE", "PARTIAL", "RETURNED"]),
    })
    .openapi("DeliveryDetailRow")
);

export const PeriodDetailResponseSchema = z
  .object({
    data: z.array(DeliveryDetailRowSchema),
    total: z.number(),
    truncated: z.boolean(),
  })
  .openapi("PeriodDetailResponse");
registry.register("PeriodDetailResponse", PeriodDetailResponseSchema);

/** Página de la tabla de entregas del periodo: `{ data, total }` como el resto. */
export const PeriodDeliveriesResponseSchema = registry.register(
  "PeriodDeliveriesResponse",
  z
    .object({ data: z.array(DeliveryDetailRowSchema), total: z.number() })
    .openapi("PeriodDeliveriesResponse")
);
