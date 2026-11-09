import { z } from "@core/swagger/registry";

const qty = z.number().positive().max(999999);

export const HotelExtraCreateDto = z.object({
  roomId: z.string().min(1),
  productId: z.string().min(1),
  quantity: qty,
  /** Punto de Recepción cuya dotación surte; sin él, el punto REC. */
  warehouseId: z.string().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelExtraCreateInput = z.infer<typeof HotelExtraCreateDto>;

export const HotelExtraDeliverDto = z.object({ cosignToken: z.string().min(1).nullish() });
export type HotelExtraDeliverInput = z.infer<typeof HotelExtraDeliverDto>;

export const HotelExtraCollectDto = z.object({ collectedQty: z.number().min(0).max(999999) });
export type HotelExtraCollectInput = z.infer<typeof HotelExtraCollectDto>;
