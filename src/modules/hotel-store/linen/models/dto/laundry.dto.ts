import { z } from "@core/swagger/registry";

const qty = z.number().positive().max(999999999);
const shift = z.string().trim().max(30).nullish();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HotelLaundryProcessDto = z.object({
  moves: z
    .array(
      z.object({
        productId: z.string().min(1),
        lotId: z.string().nullish(),
        quantity: qty,
        from: z.enum(["DIRTY", "IN_PROCESS", "QUARANTINE"]),
        to: z.enum(["IN_PROCESS", "CLEAN", "QUARANTINE"]),
        treatment: z.enum(["ORDINARY", "STAIN"]).nullish(),
      })
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelLaundryProcessInput = z.infer<typeof HotelLaundryProcessDto>;

export const HotelFirstWashDto = z.object({
  fromWarehouseId: z.string().min(1).nullish(),
  toWarehouseId: z.string().min(1).nullish(),
  lines: z.array(z.object({ productId: z.string().min(1), quantity: qty, lotId: z.string().nullish() })).min(1).max(200),
  notes: z.string().trim().max(500).nullish(),
  cosignToken: z.string().min(1).nullish(),
});
export type HotelFirstWashInput = z.infer<typeof HotelFirstWashDto>;

export const HotelSupplierReturnDto = z.object({
  toWarehouseId: z.string().min(1).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: qty,
        lotId: z.string().nullish(),
        fromStage: z.enum(["DIRTY", "IN_PROCESS", "CLEAN", "QUARANTINE"]).default("QUARANTINE"),
      })
    )
    .min(1)
    .max(200),
  /** Defecto de fábrica: las notas son obligatorias. */
  notes: z.string().trim().min(1).max(500),
  cosignToken: z.string().min(1).nullish(),
});
export type HotelSupplierReturnInput = z.infer<typeof HotelSupplierReturnDto>;

export const HotelSupplyRequestCreateDto = z.object({
  requestingWarehouseId: z.string().min(1),
  /** Sin él: la lavandería activa (blancos). Para consumibles es obligatorio (almacén de amenidades). */
  sourceWarehouseId: z.string().min(1).nullish(),
  date: day.nullish(),
  shift,
  checkouts: z.number().int().min(0).max(100000).default(0),
  occupied: z.number().int().min(0).max(100000).default(0),
  notes: z.string().trim().max(500).nullish(),
  lines: z
    .array(z.object({ productId: z.string().min(1), requestedQty: qty, notes: z.string().trim().max(300).nullish() }))
    .min(1)
    .max(200),
});
export type HotelSupplyRequestCreateInput = z.infer<typeof HotelSupplyRequestCreateDto>;

export const HotelSupplyRequestFulfillDto = z.object({
  lines: z.array(z.object({ lineId: z.string().min(1), deliveredQty: z.number().min(0).max(999999999) })).min(1).max(200),
  /** Quien surte, si no es el usuario de la sesión. */
  cosignToken: z.string().min(1).nullish(),
});
export type HotelSupplyRequestFulfillInput = z.infer<typeof HotelSupplyRequestFulfillDto>;

export const HotelDirtyReceiptCreateDto = z.object({
  originWarehouseId: z.string().min(1),
  cartNumber: z.string().trim().max(30).nullish(),
  shift,
  date: day.nullish(),
  notes: z.string().trim().max(500).nullish(),
  /** Confirmación de quien entrega (auxiliar de piso / Spa): obligatoria. */
  cosignToken: z.string().min(1),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        receivedDirty: z.number().min(0).max(999999999),
        stillInUse: z.number().min(0).max(999999999).default(0),
        good: z.number().min(0).max(999999999).default(0),
        stained: z.number().min(0).max(999999999).default(0),
        damaged: z.number().min(0).max(999999999).default(0),
      })
    )
    .min(1)
    .max(200),
});
export type HotelDirtyReceiptCreateInput = z.infer<typeof HotelDirtyReceiptCreateDto>;
