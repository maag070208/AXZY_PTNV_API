import { z } from "@core/swagger/registry";

const reasonCode = z.enum(["R", "D", "M", "Q", "F"]);

export const HotelWriteoffLineDto = z.object({
  productId: z.string().min(1),
  lotId: z.string().min(1).nullish(),
  quantity: z.number().positive().max(999999999),
  reasonCode,
});

/** El cuerpo llega como multipart: `lines` es un JSON en texto y las fotos van en `photos`. */
export const HotelWriteoffCreateDto = z.object({
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).nullish(),
  lines: z.array(HotelWriteoffLineDto).min(1).max(200),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelWriteoffCreateInput = z.infer<typeof HotelWriteoffCreateDto>;

export const HotelWriteoffReviewDto = z.object({
  notes: z.string().trim().max(500).nullish(),
  cosignToken: z.string().min(1).nullish(),
});

export const HotelWriteoffApproveDto = z.object({
  disposition: z.enum(["SECOND_LIFE", "DISPOSAL"]),
  notes: z.string().trim().max(500).nullish(),
  cosignToken: z.string().min(1).nullish(),
});

export const HotelWriteoffRejectDto = z.object({
  notes: z.string().trim().min(1).max(500),
  cosignToken: z.string().min(1).nullish(),
});
