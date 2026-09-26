import { z } from "zod";
import { registry } from "@core/swagger/registry";

const DashboardActivitySchema = registry.register(
  "DashboardActivity",
  z
    .object({
      id: z.string(),
      scope: z.enum(["devices", "tickets", "custodyLetters", "materialOutputs", "inventory"]),
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
        available: z.number(),
        assigned: z.number(),
        retirement: z.number(),
      }),
      tickets: z.object({
        total: z.number(),
        open: z.number(),
        inProgress: z.number(),
        closed: z.number(),
      }),
      custodyLetters: z.object({ total: z.number(), active: z.number() }),
      materialOutputs: z.object({ total: z.number(), damaged: z.number() }),
      departments: z.number(),
      employees: z.number(),
      ticketMetrics: z.object({
        resolvedTasks: z.number(),
        pendingTasks: z.number(),
        avgResolutionDays: z.number().nullable(),
      }),
      ticketEfficiency: z.array(
        z.object({
          user: z.object({
            id: z.string(),
            name: z.string(),
            jobTitle: z.string().nullable(),
          }),
          resolved: z.number(),
          pending: z.number(),
          avgDays: z.number().nullable(),
        })
      ),
      urgentTickets: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
          createdAt: z.string(),
          daysOnHold: z.number(),
          assigned: z.string().nullable(),
        })
      ),
      recentActivity: z.array(DashboardActivitySchema),
    })
    .openapi("DashboardSummary")
);

export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
