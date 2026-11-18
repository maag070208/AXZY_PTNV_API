import { z } from "@core/swagger/registry";

export const HotelTransferSignoffDto = z
  .object({
    result: z.enum(["CONFORM", "DIFFERENCE"]),
    notes: z.string().trim().max(500).nullish(),
  })
  .openapi("HotelTransferSignoffInput");
export type HotelTransferSignoffInput = z.infer<typeof HotelTransferSignoffDto>;
