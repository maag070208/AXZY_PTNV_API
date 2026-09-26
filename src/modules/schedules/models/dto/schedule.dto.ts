import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema } from "@core/swagger/table.dto";

/** Hora "de pared" HH:mm. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "TIME_FORMAT");

export const ScheduleDaySchema = registry.register(
  "ScheduleDay",
  z.object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    splitStartTime: z.string().nullable(),
    splitEndTime: z.string().nullable(),
    restDay: z.boolean(),
  })
);

export const ScheduleSchema = registry.register(
  "Schedule",
  z.object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    entryToleranceMin: z.number().int(),
    exitToleranceMin: z.number().int(),
    mealBreakMin: z.number().int(),
    minOvertimeMin: z.number().int(),
    crossesMidnight: z.boolean(),
    days: z.array(ScheduleDaySchema),
    assigned: z.number().int().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
);

const ScheduleDayInput = z.object({
  weekday: z.number().int().min(1).max(7),
  startTime: HHMM.nullable().optional(),
  endTime: HHMM.nullable().optional(),
  splitStartTime: HHMM.nullable().optional(),
  splitEndTime: HHMM.nullable().optional(),
  restDay: z.boolean().optional(),
});

export const ScheduleCreateDto = registry.register(
  "ScheduleCreateInput",
  z.object({
    name: z.string().min(1).max(80),
    entryToleranceMin: z.number().int().min(0).max(240).optional(),
    exitToleranceMin: z.number().int().min(0).max(240).optional(),
    mealBreakMin: z.number().int().min(0).max(240).optional(),
    minOvertimeMin: z.number().int().min(0).max(1440).optional(),
    crossesMidnight: z.boolean().optional(),
    days: z.array(ScheduleDayInput).min(1).max(7),
  })
);
export type ScheduleCreateInput = z.infer<typeof ScheduleCreateDto>;

export const ScheduleUpdateDto = registry.register(
  "ScheduleUpdateInput",
  z
    .object({
      name: z.string().min(1).max(80).optional(),
      entryToleranceMin: z.number().int().min(0).max(240).optional(),
      exitToleranceMin: z.number().int().min(0).max(240).optional(),
      mealBreakMin: z.number().int().min(0).max(240).optional(),
      minOvertimeMin: z.number().int().min(0).max(1440).optional(),
      crossesMidnight: z.boolean().optional(),
      active: z.boolean().optional(),
      days: z.array(ScheduleDayInput).min(1).max(7).optional(),
    })
    .openapi("ScheduleUpdateInput")
);
export type ScheduleUpdateInput = z.infer<typeof ScheduleUpdateDto>;

export const AssignmentCreateDto = registry.register(
  "ScheduleAssignmentCreateInput",
  z.object({
    scheduleId: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DATE_FORMAT"),
  })
);
export type AssignmentCreateInput = z.infer<typeof AssignmentCreateDto>;

export const AssignmentRemoveDto = registry.register(
  "ScheduleAssignmentRemoveInput",
  z.object({
    scheduleId: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
  })
);
export type AssignmentRemoveInput = z.infer<typeof AssignmentRemoveDto>;

export const OvertimeQuerySchema = registry.register(
  "OvertimeQuery",
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
