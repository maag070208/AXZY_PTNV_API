import { z } from "@core/swagger/registry";

export const SupplierCategoryCreateDto = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().optional(),
});
export const SupplierCategoryUpdateDto = SupplierCategoryCreateDto.partial();
export type SupplierCategoryUpdateInput = z.infer<typeof SupplierCategoryUpdateDto>;

/** Categorías de un proveedor: conjunto completo (reemplaza las anteriores). */
export const SupplierCategoriesSetDto = z.object({
  categoryIds: z.array(z.string().min(1)).max(100),
});
export type SupplierCategoriesSetInput = z.infer<typeof SupplierCategoriesSetDto>;
