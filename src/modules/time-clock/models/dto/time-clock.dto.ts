import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";
import {
  AccessReportQuerySchema,
  AccessReportSessionRowSchema,
  AccessReportSummarySchema,
} from "@modules/access/models/dto/access-report.dto";

export const PunchMethodSchema = z
  .enum(["FACE", "FINGERPRINT", "CARD", "OTHER"])
  .openapi("PunchMethod");

export const PunchSchema = registry.register(
  "TimeClockPunch",
  z.object({
    id: z.string(),
    clockSerial: z.string(),
    /** Nombre del reloj donde se checó (`null` si nunca se le puso nombre). */
    clock: z.string().nullable(),
    serialNo: z.number().int(),
    employeeNumber: z.string(),
    name: z.string(),
    method: PunchMethodSchema,
    minor: z.number().int(),
    occurredAt: z.string(),
    createdAt: z.string(),
  })
);

/**
 * `POST /checador/query`. Filtros (dentro de `filters`): `q` (nombre o número
 * de empleado), `numeroEmpleado` (exacto), `dispositivoSerie` (reloj),
 * `metodo`, `desde`/`hasta` (`YYYY-MM-DD` locales, `hasta` inclusive) y `tz`
 * (IANA, opcional).
 */
export const PunchQuerySchema = TableQuerySchema;

export const PunchTableResponseSchema = paginatedTableResponseSchema(
  PunchSchema,
  "PunchTableResponse"
);

export const TimeClockRunSchema = registry.register(
  "TimeClockRun",
  z.object({
    ok: z.boolean(),
    clockSerial: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string(),
    readCount: z.number().int(),
    newCount: z.number().int(),
    lastSerialNo: z.number().int().nullable(),
    error: z.string().nullable(),
  })
);

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DATE_FORMAT");

/** `POST /checador/import`: días locales inclusive y zona IANA opcional. */
export const TimeClockImportDto = registry.register(
  "TimeClockImportInput",
  z.object({
    from: DAY,
    to: DAY,
    tz: z.string().min(1).optional(),
  })
);
export type TimeClockImportInput = z.infer<typeof TimeClockImportDto>;

export const TimeClockImportSchema = registry.register(
  "TimeClockImport",
  z.object({
    from: z.string(),
    to: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    total: z.number().int().nullable(),
    readCount: z.number().int(),
    newCount: z.number().int(),
    error: z.string().nullable(),
  })
);

/**
 * Avance de la corrida en curso, en eventos del reloj (consecutivos): `total`
 * los que hay que revisar (se fija con la cota del inicio), `leidos` los ya
 * revisados y `restantes` los que faltan; `null` mientras el reloj no da la
 * cota. De esos eventos solo se leen las checadas. Lo devuelven
 * `GET /checador/status` (en `enCurso`) y `POST /checador/sync` (202).
 */
export const TimeClockProgressSchema = registry.register(
  "TimeClockProgress",
  z.object({
    startedAt: z.string(),
    readCount: z.number().int(),
    newCount: z.number().int(),
    remaining: z.number().int().nullable(),
    total: z.number().int().nullable(),
  })
);

/** Un reloj dado de alta y el estado de su sincronización. */
export const TimeClockDeviceSchema = registry.register(
  "TimeClockDevice",
  z.object({
    clockSerial: z.string(),
    name: z.string(),
    url: z.string(),
    countsAttendance: z.boolean(),
    model: z.string().nullable(),
    lastSerialNo: z.number().int(),
    syncedAt: z.string().nullable(),
    punches: z.number().int(),
    lastPunch: z.string().nullable(),
    inProgress: TimeClockProgressSchema.nullable(),
    lastRun: TimeClockRunSchema.nullable(),
    pausedByCredentials: z.boolean(),
  })
);

/** `enCurso` suma las corridas en curso de todos los relojes. */
export const TimeClockStatusSchema = registry.register(
  "TimeClockStatus",
  z.object({
    configured: z.boolean(),
    inProgress: TimeClockProgressSchema.nullable(),
    importJob: TimeClockImportSchema.nullable(),
    devices: z.array(TimeClockDeviceSchema),
  })
);

// ── Relojes (alta, baja y configuración; solo se LEE del reloj) ─────────────

/**
 * `POST /checador/relojes`: la dirección del reloj (`192.168.1.132`, o la URL
 * que se copia del navegador; se guarda solo `http(s)://host[:puerto]`), un
 * nombre opcional (sin él, el que tenga configurado el reloj) y si cuenta para
 * entradas/salidas (default sí).
 */
export const TimeClockDto = registry.register(
  "TimeClockInput",
  z.object({
    url: z.string().trim().min(1).max(300),
    name: z.string().trim().max(80).optional(),
    countsAttendance: z.boolean().optional(),
  })
);
export type TimeClockInput = z.infer<typeof TimeClockDto>;

/**
 * `PATCH /checador/relojes/:serie`: cambia cómo lo usa el sistema (su nombre y
 * si cuenta para entradas/salidas). No toca el reloj.
 */
export const TimeClockUpdateDto = registry.register(
  "TimeClockUpdate",
  z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      countsAttendance: z.boolean().optional(),
    })
    .refine((v) => v.name !== undefined || v.countsAttendance !== undefined, {
      message: "TIME_CLOCK_CHANGES_REQUIRED",
    })
);
export type TimeClockUpdate = z.infer<typeof TimeClockUpdateDto>;

export const TimeClockConfigSchema = registry.register(
  "TimeClockConfig",
  z.object({
    clockSerial: z.string(),
    readAt: z.string(),
    device: z.object({
      name: z.string().nullable(),
      model: z.string().nullable(),
      firmware: z.string().nullable(),
      mac: z.string().nullable(),
    }),
    hour: z
      .object({
        localTime: z.string(),
        mode: z.string().nullable(),
        zone: z.string().nullable(),
        driftSeconds: z.number().int(),
      })
      .nullable(),
    people: z
      .object({
        total: z.number().int(),
        withFace: z.number().int(),
        withFingerprint: z.number().int(),
        withCard: z.number().int(),
      })
      .nullable(),
  })
);

// ── Vinculación de empleados del reloj ───────────────────────────────────────

const TimeClockUserRefSchema = z.object({
  userId: z.string(),
  name: z.string(),
  employeeNumber: z.string().nullable(),
  active: z.boolean(),
});

export const TimeClockEmployeeSchema = registry.register(
  "TimeClockEmployee",
  z.object({
    employeeNumber: z.string().describe("Employee number on the time clock"),
    name: z.string().describe("Name as stored on the time clock"),
    punches: z.number().int(),
    lastPunch: z.string(),
    link: TimeClockUserRefSchema.nullable(),
    suggestion: TimeClockUserRefSchema.extend({ confidence: z.enum(["HIGH", "MEDIUM"]) }).nullable(),
  })
);

/** `POST /checador/empleados/query`. Filtros: `q` y `estado` (VINCULADO, SIN_VINCULAR, SUGERIDO). */
export const TimeClockEmployeesQuerySchema = TableQuerySchema;

export const TimeClockEmployeesResponseSchema = registry.register(
  "TimeClockEmployeesResponse",
  z.object({
    data: z.array(TimeClockEmployeeSchema),
    total: z.number(),
    page: z.number(),
    pageIndex: z.number(),
    totalPages: z.number(),
    totalCount: z.number(),
    limit: z.number(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    summary: z.object({
      total: z.number().int(),
      linkedCount: z.number().int(),
      withoutLink: z.number().int(),
      registrationSuggestions: z.number().int(),
    }),
  })
);

export const TimeClockLinkDto = registry.register(
  "TimeClockLinkInput",
  z.object({ userId: z.string().min(1) })
);

// ── Reporte de entradas/salidas del reloj ────────────────────────────────────

/** Mismo body que `/access/report` (period, date, tz, departmentId, q, includeInactive). */
export const TimeClockReportQuerySchema = AccessReportQuerySchema;

export const TimeClockReportSessionRowSchema = registry.register(
  "TimeClockReportSessionRow",
  AccessReportSessionRowSchema.extend({
    linked: z.boolean().describe("false = time clock number without a linked user"),
  })
);

export const TimeClockReportResponseSchema = registry.register(
  "TimeClockReportResponse",
  z.object({
    data: z.array(TimeClockReportSessionRowSchema),
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

export const TimeClockReportExportResponseSchema = registry.register(
  "TimeClockReportExportResponse",
  z.object({
    data: z.array(TimeClockReportSessionRowSchema),
    total: z.number(),
    summary: AccessReportSummarySchema,
  })
);
