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
    /** Nombre del reloj donde se checó (`null` si nunca se le puso nombre). */
    reloj: z.string().nullable(),
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
 * de empleado), `numeroEmpleado` (exacto), `dispositivoSerie` (reloj),
 * `metodo`, `desde`/`hasta` (`YYYY-MM-DD` locales, `hasta` inclusive) y `tz`
 * (IANA, opcional).
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

/**
 * Avance de la corrida en curso, en eventos del reloj (consecutivos): `total`
 * los que hay que revisar (se fija con la cota del inicio), `leidos` los ya
 * revisados y `restantes` los que faltan; `null` mientras el reloj no da la
 * cota. De esos eventos solo se leen las checadas. Lo devuelven
 * `GET /checador/status` (en `enCurso`) y `POST /checador/sync` (202).
 */
export const ChecadorProgresoSchema = registry.register(
  "ChecadorProgreso",
  z.object({
    startedAt: z.string(),
    leidos: z.number().int(),
    nuevas: z.number().int(),
    restantes: z.number().int().nullable(),
    total: z.number().int().nullable(),
  })
);

/** Un reloj dado de alta y el estado de su sincronización. */
export const ChecadorDispositivoSchema = registry.register(
  "ChecadorDispositivo",
  z.object({
    dispositivoSerie: z.string(),
    nombre: z.string(),
    url: z.string(),
    asistencia: z.boolean(),
    modelo: z.string().nullable(),
    ultimoSerialNo: z.number().int(),
    sincronizadoEn: z.string().nullable(),
    checadas: z.number().int(),
    ultimaChecada: z.string().nullable(),
    enCurso: ChecadorProgresoSchema.nullable(),
    ultimaCorrida: ChecadorCorridaSchema.nullable(),
    pausadoPorCredenciales: z.boolean(),
  })
);

/** `enCurso` suma las corridas en curso de todos los relojes. */
export const ChecadorStatusSchema = registry.register(
  "ChecadorStatus",
  z.object({
    configurado: z.boolean(),
    enCurso: ChecadorProgresoSchema.nullable(),
    importacion: ChecadorImportacionSchema.nullable(),
    dispositivos: z.array(ChecadorDispositivoSchema),
  })
);

// ── Relojes (alta, baja y configuración; solo se LEE del reloj) ─────────────

/**
 * `POST /checador/relojes`: la dirección del reloj (`192.168.1.132`, o la URL
 * que se copia del navegador; se guarda solo `http(s)://host[:puerto]`), un
 * nombre opcional (sin él, el que tenga configurado el reloj) y si cuenta para
 * entradas/salidas (default sí).
 */
export const ChecadorRelojDto = registry.register(
  "ChecadorRelojInput",
  z.object({
    url: z.string().trim().min(1).max(300),
    nombre: z.string().trim().max(80).optional(),
    asistencia: z.boolean().optional(),
  })
);
export type ChecadorRelojInput = z.infer<typeof ChecadorRelojDto>;

/**
 * `PATCH /checador/relojes/:serie`: cambia cómo lo usa el sistema (su nombre y
 * si cuenta para entradas/salidas). No toca el reloj.
 */
export const ChecadorRelojUpdateDto = registry.register(
  "ChecadorRelojUpdate",
  z
    .object({
      nombre: z.string().trim().min(1).max(80).optional(),
      asistencia: z.boolean().optional(),
    })
    .refine((v) => v.nombre !== undefined || v.asistencia !== undefined, {
      message: "Indica el nombre o si cuenta para entradas/salidas",
    })
);
export type ChecadorRelojUpdate = z.infer<typeof ChecadorRelojUpdateDto>;

export const ChecadorRelojConfigSchema = registry.register(
  "ChecadorRelojConfig",
  z.object({
    dispositivoSerie: z.string(),
    leidoEn: z.string(),
    dispositivo: z.object({
      nombre: z.string().nullable(),
      modelo: z.string().nullable(),
      firmware: z.string().nullable(),
      mac: z.string().nullable(),
    }),
    hora: z
      .object({
        horaLocal: z.string(),
        modo: z.string().nullable(),
        zona: z.string().nullable(),
        desfaseSegundos: z.number().int(),
      })
      .nullable(),
    personas: z
      .object({
        total: z.number().int(),
        conRostro: z.number().int(),
        conHuella: z.number().int(),
        conTarjeta: z.number().int(),
      })
      .nullable(),
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
