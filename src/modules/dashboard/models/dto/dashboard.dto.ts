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
      targetId: z.string().nullable(),
      deviceId: z.string().nullable(),
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
      ticketMetricas: z.object({
        tareasResueltas: z.number(),
        tareasPendientes: z.number(),
        avgResolucionDias: z.number().nullable(),
      }),
      ticketEficiencia: z.array(
        z.object({
          user: z.object({
            id: z.string(),
            name: z.string(),
            puesto: z.string().nullable(),
          }),
          resueltas: z.number(),
          pendientes: z.number(),
          avgDias: z.number().nullable(),
        })
      ),
      ticketsUrgentes: z.array(
        z.object({
          id: z.string(),
          titulo: z.string(),
          prioridad: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]),
          creadoEn: z.string(),
          diasEnEspera: z.number(),
          asignado: z.string().nullable(),
        })
      ),
      recentActivity: z.array(DashboardActivitySchema),
    })
    .openapi("DashboardSummary")
);

export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
