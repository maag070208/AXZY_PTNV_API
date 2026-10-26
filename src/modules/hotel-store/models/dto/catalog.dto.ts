import { z } from "@core/swagger/registry";

export const HotelProductKindSchema = z.enum(["CONSUMIBLE", "TEXTIL", "QUIMICO", "EQUIPO"]);
export const HotelKitFrequencySchema = z.enum(["CADA_LIMPIEZA", "SOLO_CHECKOUT", "CADA_N_DIAS"]);

const stock = z.number().nonnegative().max(999999999);

export const HotelUnitCreateDto = z.object({
  name: z.string().trim().min(1).max(60),
  whole: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const HotelUnitUpdateDto = HotelUnitCreateDto.partial();
export type HotelUnitUpdateInput = z.infer<typeof HotelUnitUpdateDto>;

export const HotelProductCategoryCreateDto = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().optional(),
});
export const HotelProductCategoryUpdateDto = HotelProductCategoryCreateDto.partial();
export type HotelProductCategoryUpdateInput = z.infer<typeof HotelProductCategoryUpdateDto>;

export const HotelProductCreateDto = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  categoryId: z.string().nullish(),
  unitId: z.string().min(1),
  kind: HotelProductKindSchema.optional(),
  minStock: stock.optional(),
  idealStock: stock.optional(),
  overstock: stock.optional(),
  active: z.boolean().optional(),
});
export type HotelProductCreateInput = z.infer<typeof HotelProductCreateDto>;
export const HotelProductUpdateDto = HotelProductCreateDto.partial();
export type HotelProductUpdateInput = z.infer<typeof HotelProductUpdateDto>;

export const HotelKitCreateDto = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  active: z.boolean().optional(),
});
export const HotelKitUpdateDto = HotelKitCreateDto.partial();
export type HotelKitUpdateInput = z.infer<typeof HotelKitUpdateDto>;

export const HotelKitLinesDto = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive().max(999999999),
        frequency: HotelKitFrequencySchema.optional(),
        everyNDays: z.number().int().min(1).max(365).nullish(),
      })
    )
    .max(200),
});
export type HotelKitLinesInput = z.infer<typeof HotelKitLinesDto>;
