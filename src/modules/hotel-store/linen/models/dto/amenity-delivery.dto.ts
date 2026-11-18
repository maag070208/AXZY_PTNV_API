import { z } from "@core/swagger/registry";

export const HotelAmenityDeliveryCreateDto = z
  .object({
    fromWarehouseId: z.string().min(1),
    toWarehouseId: z.string().min(1),
    /** Supervisora de piso de la zona que recibe y firma. */
    recipientId: z.string().min(1),
    lines: z
      .array(z.object({ productId: z.string().min(1), quantity: z.number().positive().max(999999999) }))
      .min(1)
      .max(200),
    notes: z.string().trim().max(500).nullish(),
  })
  .openapi("HotelAmenityDeliveryCreateInput");
export type HotelAmenityDeliveryCreateInput = z.infer<typeof HotelAmenityDeliveryCreateDto>;
