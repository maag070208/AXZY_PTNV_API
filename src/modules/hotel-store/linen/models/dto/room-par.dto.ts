import { z } from "@core/swagger/registry";

export const HotelRoomComponentSchema = z.enum(["ROOM", "KING_BED", "QUEEN_BED", "SOFA_BED", "BATHROOM"]);

export const HotelRoomParKindSchema = z.enum(["LINEN", "CONSUMABLE"]);

export const HotelRoomParSaveDto = z
  .object({
    kind: HotelRoomParKindSchema,
    lines: z
      .array(
        z.object({
          component: HotelRoomComponentSchema,
          productId: z.string().min(1),
          quantity: z.number().int().min(0).max(999),
        })
      )
      .max(2000),
  })
  .openapi("HotelRoomParSaveInput");
export type HotelRoomParSaveInput = z.infer<typeof HotelRoomParSaveDto>;
