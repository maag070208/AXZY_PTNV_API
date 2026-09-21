import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const MotivoActaAdministrativaSchema = z.enum([
  "INASISTENCIA",
  "RETARDO",
  "EBRIEDAD",
  "CONDUCTA",
  "INCUMPLIMIENTO",
  "OTRO",
]);

export const ActaAdministrativaSchema = z
  .object({
    id: z.string(),
    motivo: MotivoActaAdministrativaSchema,
    fechaIncidente: z.string(),
    descripcion: z.string(),
    sancion: z.string().nullish(),
    createdAt: z.string(),
    user: z.object({
      id: z.string(),
      name: z.string(),
      numeroEmpleado: z.string().nullish(),
      puesto: z.string().nullish(),
      department: z.object({ id: z.string(), name: z.string() }).nullish(),
      subarea: z.object({ id: z.string(), name: z.string() }).nullish(),
    }),
    createdBy: z.object({ id: z.string(), name: z.string() }),
  })
  .openapi("ActaAdministrativa");
export type ActaAdministrativa = z.infer<typeof ActaAdministrativaSchema>;
registry.register("ActaAdministrativa", ActaAdministrativaSchema);

export const ActaAdministrativaCreateDto = z
  .object({
    userId: z.string().min(1),
    motivo: MotivoActaAdministrativaSchema,
    fechaIncidente: z.string().min(1),
    descripcion: z.string().min(3),
    sancion: z.string().optional(),
  })
  .openapi("ActaAdministrativaCreateInput");
export type ActaAdministrativaCreateInput = z.infer<typeof ActaAdministrativaCreateDto>;

export const ActaListResponseSchema = z
  .object({ data: z.array(ActaAdministrativaSchema), total: z.number() })
  .openapi("ActaListResponse");
registry.register("ActaListResponse", ActaListResponseSchema);

export const ActaTableResponseSchema = paginatedTableResponseSchema(
  ActaAdministrativaSchema,
  "ActaTableResponse"
);

export const ActaQueryListSchema = TableQuerySchema;