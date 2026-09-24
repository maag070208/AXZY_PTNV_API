import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";
import {
  AccessReportQuerySchema,
  AccessReportSessionRowSchema,
  AccessReportSummarySchema,
} from "@modules/access/models/dto/access-report.dto";

export const MetodoChecadaSchema = z
  .enum(["ROSTRO", "HUELLA", "TARJETA", "OTRO"])
  .openapi("MetodoChecada");

export const ChecadaSchema = registry.register(
  "Checada",
  z.object({
    id: z.string(),
    dispositivoSerie: z.string(),
    serialNo: z.number().int(),
    numeroEmpleado: z.string(),
    nombre: z.string(),
    metodo: MetodoChecadaSchema,
    minor: z.number().int(),
    occurredAt: z.string(),
    createdAt: z.string(),
  })
);

/**
 * `POST /checador/query`. Filtros (dentro de `filters`): `q` (nombre o número
 * de empleado), `numeroEmpleado` (exacto), `metodo`, `desde`/`hasta`
 * (`YYYY-MM-DD` locales, `hasta` inclusive) y `tz` (IANA, opcional).
 */
export const ChecadaQuerySchema = TableQuerySchema;

export const ChecadaTableResponseSchema = paginatedTableResponseSchema(
  ChecadaSchema,
  "ChecadaTableResponse"
);

export const ChecadorCorridaSchema = registry.register(
  "ChecadorCorrida",
  z.object({
    ok: z.boolean(),
    dispositivoSerie: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string(),
    leidos: z.number().int(),
    nuevas: z.number().int(),
    ultimoSerialNo: z.number().int().nullable(),
    error: z.string().nullable(),
  })
);

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");

/** `POST /checador/import`: días locales inclusive y zona IANA opcional. */
export const ChecadorImportDto = registry.register(
  "ChecadorImportInput",
  z.object({
    desde: DIA,
    hasta: DIA,
    tz: z.string().min(1).optional(),
  })
);
export type ChecadorImportInput = z.infer<typeof ChecadorImportDto>;

export const ChecadorImportacionSchema = registry.register(
  "ChecadorImportacion",
  z.object({
    desde: z.string(),
    hasta: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    total: z.number().int().nullable(),
    leidos: z.number().int(),
    nuevas: z.number().int(),
    error: z.string().nullable(),
  })
);

export const ChecadorStatusSchema = registry.register(
  "ChecadorStatus",
  z.object({
    configurado: z.boolean(),
    enCurso: z
      .object({
        startedAt: z.string(),
        leidos: z.number().int(),
        nuevas: z.number().int(),
        restantes: z.number().int().nullable(),
      })
      .nullable(),
    pausadoPorCredenciales: z.boolean(),
    ultimaCorrida: ChecadorCorridaSchema.nullable(),
    importacion: ChecadorImportacionSchema.nullable(),
    dispositivos: z.array(
      z.object({
        dispositivoSerie: z.string(),
        modelo: z.string().nullable(),
        ultimoSerialNo: z.number().int(),
        sincronizadoEn: z.string().nullable(),
        checadas: z.number().int(),
        ultimaChecada: z.string().nullable(),
      })
    ),
  })
);

// ── Vinculación de empleados del reloj ───────────────────────────────────────

const ChecadorUsuarioRefSchema = z.object({
  userId: z.string(),
  name: z.string(),
  numeroEmpleado: z.string().nullable(),
  active: z.boolean(),
});

export const ChecadorEmpleadoSchema = registry.register(
  "ChecadorEmpleado",
  z.object({
    numeroEmpleado: z.string().describe("Número del empleado en el reloj"),
    nombre: z.string().describe("Nombre como está en el reloj"),
    checadas: z.number().int(),
    ultimaChecada: z.string(),
    vinculo: ChecadorUsuarioRefSchema.nullable(),
    sugerencia: ChecadorUsuarioRefSchema.extend({ confianza: z.enum(["ALTA", "MEDIA"]) }).nullable(),
  })
);

/** `POST /checador/empleados/query`. Filtros: `q` y `estado` (VINCULADO, SIN_VINCULAR, SUGERIDO). */
export const ChecadorEmpleadosQuerySchema = TableQuerySchema;

export const ChecadorEmpleadosResponseSchema = registry.register(
  "ChecadorEmpleadosResponse",
  z.object({
    data: z.array(ChecadorEmpleadoSchema),
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
      vinculados: z.number().int(),
      sinVincular: z.number().int(),
      sugeridosAlta: z.number().int(),
    }),
  })
);

export const ChecadorVinculoDto = registry.register(
  "ChecadorVinculoInput",
  z.object({ userId: z.string().min(1) })
);

// ── Reporte de entradas/salidas del reloj ────────────────────────────────────

/** Mismo body que `/access/report` (period, date, tz, departmentId, q, includeInactive). */
export const ChecadorReportQuerySchema = AccessReportQuerySchema;

export const ChecadorReportSessionRowSchema = registry.register(
  "ChecadorReportSessionRow",
  AccessReportSessionRowSchema.extend({
    vinculado: z.boolean().describe("false = número del reloj sin usuario vinculado"),
  })
);

export const ChecadorReportResponseSchema = registry.register(
  "ChecadorReportResponse",
  z.object({
    data: z.array(ChecadorReportSessionRowSchema),
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

export const ChecadorReportExportResponseSchema = registry.register(
  "ChecadorReportExportResponse",
  z.object({
    data: z.array(ChecadorReportSessionRowSchema),
    total: z.number(),
    summary: AccessReportSummarySchema,
  })
);
