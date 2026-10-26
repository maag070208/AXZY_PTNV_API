import { z } from "@core/swagger/registry";

export const HotelStocktakeCreateDto = z.object({
  warehouseId: z.string().min(1),
  notes: z.string().trim().max(500).nullish(),
  blind: z.boolean().optional(),
});

export const HotelStocktakeCaptureDto = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        locationId: z.string().min(1),
        countedQty: z.number().nonnegative().max(999999999),
        notes: z.string().trim().max(500).nullish(),
      })
    )
    .min(1)
    .max(500),
});
