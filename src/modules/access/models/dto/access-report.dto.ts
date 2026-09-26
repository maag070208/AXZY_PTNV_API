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
    date: z.string().describe("Local day (YYYY-MM-DD) of the attribution"),
    entryAt: z.string().nullable(),
    exitAt: z.string().nullable(),
    workedMinutes: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    incidents: z.array(AccessIncidentCodeSchema),
    crossesMidnight: z.boolean().describe("Some session of the day crossed local midnight"),
  })
);

export const AccessReportPersonRowSchema = registry.register(
  "AccessReportPersonRow",
  z.object({
    employeeId: z.string(),
    employeeName: z.string(),
    employeeNumber: z.string().nullable(),
    jobTitle: z.string().nullable(),
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
      .describe("Daily detail; only present in the rows of the returned page"),
  })
);

export const AccessReportSessionRowSchema = registry.register(
  "AccessReportSessionRow",
  z.object({
    id: z.string(),
    employeeId: z.string(),
    employeeName: z.string(),
    employeeNumber: z.string().nullable(),
    jobTitle: z.string().nullable(),
    departmentId: z.string().nullable(),
    departmentName: z.string().nullable(),
    active: z.boolean(),
    date: z.string().describe("Local day (YYYY-MM-DD) of the session"),
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
        date: z.string().describe("Local reference day (YYYY-MM-DD)"),
        tz: z.string().optional().describe("IANA time zone (defaults to America/Mexico_City)"),
        departmentId: z.string().optional(),
        employeeId: z.string().optional(),
        q: z.string().optional(),
        includeInactive: z
          .boolean()
          .optional()
          .describe("Include deactivated users without records in the universe (default false)"),
      })
      .nullish(),
  })
);
