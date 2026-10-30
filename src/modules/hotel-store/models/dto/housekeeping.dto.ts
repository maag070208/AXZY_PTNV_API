import { z } from "@core/swagger/registry";

export const HotelCleaningTypeSchema = z.enum(["CHECKOUT", "STAY", "TURNDOWN"]);

export const HotelTaskCreateDto = z.object({
  roomId: z.string().min(1),
  cleaningType: HotelCleaningTypeSchema,
});

export const HotelTaskAssignDto = z.object({
  assigneeId: z.string().min(1),
});

export const HotelTaskExtraDto = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive().max(999999999),
});

export const HotelInspectionDto = z.object({
  result: z.enum(["APPROVED", "REJECTED"]),
  reasonId: z.string().nullish(),
  notes: z.string().trim().max(500).nullish(),
});
