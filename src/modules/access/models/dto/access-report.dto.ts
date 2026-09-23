import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";

/** Granularidad del reporte: define la VENTANA, no la dimensión de la fila. */
export const AccessReportPeriodSchema = z.enum(["DAY", "WEEK", "MONTH"]);

/** Incidencias derivadas del emparejamiento ENTRY/EXIT. */
export const AccessIncidentCodeSchema = z.enum([
  "ENTRY_WITHOUT_EXIT",
  "EXIT_WITHOUT_ENTRY",
  "OPEN_ENTRY",
]);

export const AccessReportDaySchema = registry.register(
  "AccessReportDay",
  z.object({
    date: z.string().describe("Día local (YYYY-MM-DD) de la atribución"),
    entryAt: z.string().nullable(),
    exitAt: z.string().nullable(),
    workedMinutes: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    incidents: z.array(AccessIncidentCodeSchema),
    crossesMidnight: z.boolean().describe("Alguna sesión del día cruzó la medianoche local"),
  })
);

export const AccessReportPersonRowSchema = registry.register(
  "AccessReportPersonRow",
  z.object({
    employeeId: z.string(),
    employeeName: z.string(),
    numeroEmpleado: z.string().nullable(),
    puesto: z.string().nullable(),
    departmentId: z.string().nullable(),
    departmentName: z.string().nullable(),
    active: z.boolean(),
    hasRecords: z.boolean(),
    firstEntryAt: z.string().nullable(),
    lastExitAt: z.string().nullable(),
    workedMinutes: z.number().int().nonnegative(),
    sessionCount: z.number().int().nonnegative(),
    daysWithRecords: z.number().int().nonnegative(),
    incidents: z.array(AccessIncidentCodeSchema),
    days: z
      .array(AccessReportDaySchema)
      .describe("Detalle diario; solo presente en las filas de la página devuelta"),
  })
);

export const AccessReportSessionRowSchema = registry.register(
  "AccessReportSessionRow",
  z.object({
    id: z.string(),
    employeeId: z.string(),
    employeeName: z.string(),
    numeroEmpleado: z.string().nullable(),
    puesto: z.string().nullable(),
    departmentId: z.string().nullable(),
    departmentName: z.string().nullable(),
    active: z.boolean(),
    date: z.string().describe("Día local (YYYY-MM-DD) de la sesión"),
    entryAt: z.string().nullable(),
    exitAt: z.string().nullable(),
    workedMinutes: z.number().int().nonnegative(),
    incident: AccessIncidentCodeSchema.nullable(),
    crossesMidnight: z.boolean(),
  })
);

export const AccessReportSummarySchema = registry.register(
  "AccessReportSummary",
  z.object({
    peopleTotal: z.number().int().nonnegative(),
    peopleWithRecords: z.number().int().nonnegative(),
    peopleWithoutRecords: z.number().int().nonnegative(),
    peopleInside: z.number().int().nonnegative(),
    totalWorkedMinutes: z.number().int().nonnegative(),
    totalIncidents: z.number().int().nonnegative(),
    range: z.object({
      start: z.string(),
      end: z.string(),
      timezone: z.string(),
      period: AccessReportPeriodSchema,
    }),
  })
);

export const AccessReportResponseSchema = registry.register(
  "AccessReportResponse",
  z.object({
    data: z.array(AccessReportSessionRowSchema),
    total: z.number(),
    page: z.number(),
    pageIndex: z.number(),
    totalPages: z.number(),
    totalCount: z.number(),
    limit: z.number(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    summary: AccessReportSummarySchema,
  })
);

export const AccessReportExportResponseSchema = registry.register(
  "AccessReportExportResponse",
  z.object({
    data: z.array(AccessReportSessionRowSchema),
    total: z.number(),
    summary: AccessReportSummarySchema,
  })
);

/** Body del reporte: `TableQuery` + `filters` tipados (period/date/tz/…). */
export const AccessReportQuerySchema = registry.register(
  "AccessReportQuery",
  TableQuerySchema.extend({
    filters: z
      .object({
        period: AccessReportPeriodSchema,
        date: z.string().describe("Día de referencia local (YYYY-MM-DD)"),
        tz: z.string().optional().describe("Zona horaria IANA (por defecto America/Mexico_City)"),
        departmentId: z.string().optional(),
        employeeId: z.string().optional(),
        q: z.string().optional(),
        includeInactive: z
          .boolean()
          .optional()
          .describe("Incluye bajas sin registros en el universo (default false)"),
      })
      .nullish(),
  })
);
