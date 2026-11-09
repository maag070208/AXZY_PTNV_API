import { z } from "@core/swagger/registry";

const qty = z.number().positive().max(999999);

export const HotelLoanCreateDto = z.object({
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  quantity: qty,
  guestName: z.string().trim().min(1).max(120),
  room: z.string().trim().max(30).nullish(),
  visitorId: z.string().trim().max(60).nullish(),
  depositMethod: z.enum(["CASH", "CARD", "ROOM_CHARGE"]),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelLoanCreateInput = z.infer<typeof HotelLoanCreateDto>;

export const HotelLoanReturnDto = z.object({ quantity: qty });
export type HotelLoanReturnInput = z.infer<typeof HotelLoanReturnDto>;

export const HotelShiftCloseDto = z.object({
  warehouseId: z.string().min(1),
  cosignToken: z.string().min(1).nullish(),
  endOfDay: z.boolean().optional(),
  markUnreturned: z.array(z.string().min(1)).max(500).default([]),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelShiftCloseInput = z.infer<typeof HotelShiftCloseDto>;
