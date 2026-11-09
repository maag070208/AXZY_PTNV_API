import { z } from "@core/swagger/registry";

export const HotelCosignDto = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
});
export type HotelCosignInput = z.infer<typeof HotelCosignDto>;
