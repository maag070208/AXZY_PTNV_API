import { z } from "@core/swagger/registry";

export const HotelTransferSendDto = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive().max(999999999),
        lotId: z.string().nullish(),
        fromLocationId: z.string().nullish(),
        toLocationId: z.string().nullish(),
      })
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).nullish(),
  /** Si quien entrega no es el usuario de la sesión, su confirmación de firma. */
  cosignToken: z.string().min(1).nullish(),
});
export type HotelTransferSendInput = z.infer<typeof HotelTransferSendDto>;

export const HotelTransferReceiveDto = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        receivedQuantity: z.number().min(0).max(999999999),
      })
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).nullish(),
  /** Si quien recibe no es el usuario de la sesión, su confirmación de firma. */
  cosignToken: z.string().min(1).nullish(),
});
export type HotelTransferReceiveInput = z.infer<typeof HotelTransferReceiveDto>;

export const HotelWarehouseLimitsDto = z.object({
  limits: z
    .array(
      z
        .object({
          productId: z.string().min(1),
          minStock: z.number().min(0).max(999999999),
          maxStock: z.number().min(0).max(999999999),
        })
        .refine((l) => l.maxStock === 0 || l.maxStock >= l.minStock, { message: "HOTEL_LIMIT_INVALID" })
    )
    .max(500),
});
export type HotelWarehouseLimitsInput = z.infer<typeof HotelWarehouseLimitsDto>;
