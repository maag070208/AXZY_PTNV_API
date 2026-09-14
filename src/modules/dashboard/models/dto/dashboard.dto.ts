import { z } from "zod";
import { registry } from "@core/swagger/registry";

const DashboardActivitySchema = registry.register(
  "DashboardActivity",
  z
    .object({
      id: z.string(),
      scope: z.enum(["devices", "tickets", "cartas", "salidas", "inventory"]),
      message: z.string(),
      at: z.string(),
    })
    .openapi("DashboardActivity")
);

export const DashboardSummarySchema = registry.register(
  "DashboardSummary",
  z
    .object({
      devices: z.object({
        total: z.number(),
        disponible: z.number(),
        asignado: z.number(),
        baja: z.number(),
      }),
      tickets: z.object({
        total: z.number(),
        abierto: z.number(),
        enSeguimiento: z.number(),
        cerrado: z.number(),
      }),
      cartas: z.object({ total: z.number(), activas: z.number() }),
      salidas: z.object({ total: z.number(), danadas: z.number() }),
      departamentos: z.number(),
      empleados: z.number(),
      recentActivity: z.array(DashboardActivitySchema),
    })
    .openapi("DashboardSummary")
);

export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
