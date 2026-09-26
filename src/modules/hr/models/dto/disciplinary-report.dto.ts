import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const DisciplinaryReasonSchema = z.enum([
  "ABSENCE",
  "TARDINESS",
  "INTOXICATION",
  "MISCONDUCT",
  "NONCOMPLIANCE",
  "OTHER",
]);

export const DisciplinaryReportSchema = z
  .object({
    id: z.string(),
    reason: DisciplinaryReasonSchema,
    incidentDate: z.string(),
    description: z.string(),
    sanction: z.string().nullish(),
    createdAt: z.string(),
    user: z.object({
      id: z.string(),
      name: z.string(),
      employeeNumber: z.string().nullish(),
      jobTitle: z.string().nullish(),
      department: z.object({ id: z.string(), name: z.string() }).nullish(),
      subarea: z.object({ id: z.string(), name: z.string() }).nullish(),
    }),
    createdBy: z.object({ id: z.string(), name: z.string() }),
  })
  .openapi("DisciplinaryReport");
export type DisciplinaryReport = z.infer<typeof DisciplinaryReportSchema>;
registry.register("DisciplinaryReport", DisciplinaryReportSchema);

export const DisciplinaryReportCreateDto = z
  .object({
    userId: z.string().min(1),
    reason: DisciplinaryReasonSchema,
    incidentDate: z.string().min(1),
    description: z.string().min(3),
    sanction: z.string().optional(),
  })
  .openapi("DisciplinaryReportCreateInput");
export type DisciplinaryReportCreateInput = z.infer<typeof DisciplinaryReportCreateDto>;

export const DisciplinaryReportListResponseSchema = z
  .object({ data: z.array(DisciplinaryReportSchema), total: z.number() })
  .openapi("DisciplinaryReportListResponse");
registry.register("DisciplinaryReportListResponse", DisciplinaryReportListResponseSchema);

export const DisciplinaryReportTableResponseSchema = paginatedTableResponseSchema(
  DisciplinaryReportSchema,
  "DisciplinaryReportTableResponse"
);

export const DisciplinaryReportQueryListSchema = TableQuerySchema;