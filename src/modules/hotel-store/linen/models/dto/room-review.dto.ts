import { z } from "@core/swagger/registry";

export const HotelRoomReviewCreateDto = z
  .object({
    roomId: z.string().min(1),
    responsibleId: z.string().min(1),
    shift: z.enum(["MORNING", "AFTERNOON", "NIGHT"]),
    notes: z.string().trim().max(500).nullish(),
    lines: z
      .array(z.object({ productId: z.string().min(1), counted: z.number().int().min(0).max(9999) }))
      .max(200),
  })
  .openapi("HotelRoomReviewCreateInput");
export type HotelRoomReviewCreateInput = z.infer<typeof HotelRoomReviewCreateDto>;
