import { z } from "@core/swagger/registry";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.number().positive().max(999999999);

const OrderLineDto = z.object({
  productId: z.string().min(1),
  quantity: qty,
  /** Costo antes de IVA. Sin él: el último costo del producto. */
  unitCost: z.number().min(0).max(999999999).nullish(),
  taxRateId: z.string().min(1).nullish(),
});

export const HotelPurchaseOrderCreateDto = z.object({
  supplierId: z.string().min(1).nullish(),
  warehouseId: z.string().min(1).nullish(),
  expectedDate: day.nullish(),
  notes: z.string().trim().max(500).nullish(),
  lines: z.array(OrderLineDto).min(1).max(200),
});
export type HotelPurchaseOrderCreateInput = z.infer<typeof HotelPurchaseOrderCreateDto>;

export const HotelPurchaseOrderUpdateDto = HotelPurchaseOrderCreateDto.partial();
export type HotelPurchaseOrderUpdateInput = z.infer<typeof HotelPurchaseOrderUpdateDto>;

export const HotelPurchaseCloseDto = z.object({ notes: z.string().trim().min(1).max(500) });
export type HotelPurchaseCloseInput = z.infer<typeof HotelPurchaseCloseDto>;

export const HotelPurchaseReceiptDto = z.object({
  invoiceNumber: z.string().trim().min(1).max(60),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        receivedQty: z.number().min(0).max(999999999),
        acceptedQty: z.number().min(0).max(999999999),
        heldQty: z.number().min(0).max(999999999).default(0),
        holdReason: z.string().trim().max(300).nullish(),
      })
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelPurchaseReceiptInput = z.infer<typeof HotelPurchaseReceiptDto>;

export const HotelPurchaseHoldResolveDto = z.object({
  action: z.enum(["ACCEPT", "RETURN"]),
  notes: z.string().trim().max(300).nullish(),
});
export type HotelPurchaseHoldResolveInput = z.infer<typeof HotelPurchaseHoldResolveDto>;

export const HotelPurchaseWeeklyDto = z.object({ weekFrom: day });
export type HotelPurchaseWeeklyInput = z.infer<typeof HotelPurchaseWeeklyDto>;

export const HotelPurchaseConvertDto = z.object({ supplierId: z.string().min(1), warehouseId: z.string().min(1).nullish() });
export type HotelPurchaseConvertInput = z.infer<typeof HotelPurchaseConvertDto>;
