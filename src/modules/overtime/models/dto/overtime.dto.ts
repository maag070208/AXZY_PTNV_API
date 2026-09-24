import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");

/** Filtros compartidos por consulta y decisión (periodo + dimensión de persona). */
const OvertimeFiltersSchema = z.object({
  period: z.enum(["DAY", "WEEK", "MONTH"]),
  date: DIA,
  tz: z.string().min(1).optional(),
  departmentId: z.string().optional(),
  q: z.string().optional(),
  includeInactive: z.boolean().optional(),
});

/** `POST /overtime/query`: como las tablas server-side + `status` opcional. */
export const OvertimeQuerySchema = registry.register(
  "OvertimeQuery",
  TableQuerySchema.extend({
    filters: OvertimeFiltersSchema.extend({
      status: z.enum(["PENDIENTE", "APROBADO", "RECHAZADO"]).optional(),
    }).nullish(),
  })
);

/** `POST /overtime/approvals`: decide sobre N días (persona + fecha). */
export const OvertimeApprovalSchema = registry.register(
  "OvertimeApprovalInput",
  z.object({
    filters: OvertimeFiltersSchema.nullish(),
    items: z
      .array(z.object({ userId: z.string().min(1), date: DIA }))
      .min(1, "Debes seleccionar al menos un día"),
    status: z.enum(["APROBADO", "RECHAZADO", "PENDIENTE"]),
    note: z.string().max(500).optional(),
  })
);
export type OvertimeApprovalInput = z.infer<typeof OvertimeApprovalSchema>;
