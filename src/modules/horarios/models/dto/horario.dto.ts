import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";

/** Hora "de pared" HH:mm. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm");

export const HorarioDiaSchema = registry.register(
  "HorarioDia",
  z.object({
    diaSemana: z.number().int().min(1).max(7),
    entrada: z.string().nullable(),
    salida: z.string().nullable(),
    entrada2: z.string().nullable(),
    salida2: z.string().nullable(),
    descanso: z.boolean(),
  })
);

export const HorarioSchema = registry.register(
  "Horario",
  z.object({
    id: z.string(),
    nombre: z.string(),
    activo: z.boolean(),
    toleranciaEntradaMin: z.number().int(),
    toleranciaSalidaMin: z.number().int(),
    comidaMin: z.number().int(),
    cruzaMedianoche: z.boolean(),
    dias: z.array(HorarioDiaSchema),
    asignados: z.number().int().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
);

const HorarioDiaInput = z.object({
  diaSemana: z.number().int().min(1).max(7),
  entrada: HHMM.nullable().optional(),
  salida: HHMM.nullable().optional(),
  entrada2: HHMM.nullable().optional(),
  salida2: HHMM.nullable().optional(),
  descanso: z.boolean().optional(),
});

export const HorarioCreateDto = registry.register(
  "HorarioCreateInput",
  z.object({
    nombre: z.string().min(1).max(80),
    toleranciaEntradaMin: z.number().int().min(0).max(240).optional(),
    toleranciaSalidaMin: z.number().int().min(0).max(240).optional(),
    comidaMin: z.number().int().min(0).max(240).optional(),
    cruzaMedianoche: z.boolean().optional(),
    dias: z.array(HorarioDiaInput).min(1).max(7),
  })
);
export type HorarioCreateInput = z.infer<typeof HorarioCreateDto>;

export const HorarioUpdateDto = registry.register(
  "HorarioUpdateInput",
  z
    .object({
      nombre: z.string().min(1).max(80).optional(),
      toleranciaEntradaMin: z.number().int().min(0).max(240).optional(),
      toleranciaSalidaMin: z.number().int().min(0).max(240).optional(),
      comidaMin: z.number().int().min(0).max(240).optional(),
      cruzaMedianoche: z.boolean().optional(),
      activo: z.boolean().optional(),
      dias: z.array(HorarioDiaInput).min(1).max(7).optional(),
    })
    .openapi("HorarioUpdateInput")
);
export type HorarioUpdateInput = z.infer<typeof HorarioUpdateDto>;

export const AsignacionCreateDto = registry.register(
  "HorarioAsignacionCreateInput",
  z.object({
    horarioId: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  })
);
export type AsignacionCreateInput = z.infer<typeof AsignacionCreateDto>;

export const AsignacionQuitarDto = registry.register(
  "HorarioAsignacionQuitarInput",
  z.object({
    horarioId: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
  })
);
export type AsignacionQuitarInput = z.infer<typeof AsignacionQuitarDto>;

export const HorasExtraQuerySchema = registry.register(
  "HorasExtraQuery",
  TableQuerySchema.extend({
    filters: z
      .object({
        period: z.enum(["DAY", "WEEK", "MONTH"]),
        date: z.string(),
        tz: z.string().optional(),
        departmentId: z.string().optional(),
        q: z.string().optional(),
        includeInactive: z.boolean().optional(),
      })
      .nullish(),
  })
);
