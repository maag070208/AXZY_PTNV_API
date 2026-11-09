import { z } from "@core/swagger/registry";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HotelAmenityControlSaveDto = z.object({
  warehouseId: z.string().min(1),
  weekFrom: day,
  occupiedNightsOverride: z.number().int().min(0).max(1_000_000).nullish(),
  notes: z.string().trim().max(500).nullish(),
  /** Existencia final capturada por la supervisora; sin renglón se usa la del sistema. */
  lines: z.array(z.object({ productId: z.string().min(1), finalStock: z.number().min(0).max(999999999) })).max(200).default([]),
});
export type HotelAmenityControlSaveInput = z.infer<typeof HotelAmenityControlSaveDto>;
