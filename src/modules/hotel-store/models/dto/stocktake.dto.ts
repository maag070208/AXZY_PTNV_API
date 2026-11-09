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
        /** Obligatorio salvo que vengan los grados A–E (entonces es su suma). */
        countedQty: z.number().nonnegative().max(999999999).optional(),
        gradeA: z.number().nonnegative().max(999999999).nullish(),
        gradeB: z.number().nonnegative().max(999999999).nullish(),
        gradeC: z.number().nonnegative().max(999999999).nullish(),
        gradeD: z.number().nonnegative().max(999999999).nullish(),
        gradeE: z.number().nonnegative().max(999999999).nullish(),
        notes: z.string().trim().max(500).nullish(),
      })
    )
    .min(1)
    .max(500),
});
