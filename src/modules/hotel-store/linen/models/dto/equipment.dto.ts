import { z } from "@core/swagger/registry";

export const HotelEquipmentUnitsCreateDto = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(200),
  warehouseId: z.string().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelEquipmentUnitsCreateInput = z.infer<typeof HotelEquipmentUnitsCreateDto>;

export const HotelEquipmentUnitPatchDto = z.object({
  status: z.enum(["AVAILABLE", "RETIRED"]).optional(),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelEquipmentUnitPatchInput = z.infer<typeof HotelEquipmentUnitPatchDto>;

export const HotelEquipmentLoanCreateDto = z.object({
  unitId: z.string().min(1),
  roomId: z.string().min(1),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelEquipmentLoanCreateInput = z.infer<typeof HotelEquipmentLoanCreateDto>;

export const HotelEquipmentDeliverDto = z.object({
  cosignToken: z.string().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelEquipmentDeliverInput = z.infer<typeof HotelEquipmentDeliverDto>;

export const HotelEquipmentReturnDto = z.object({
  condition: z.enum(["GOOD", "DAMAGED", "MISSING"]),
  chargeAmount: z.number().min(0).max(9999999).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type HotelEquipmentReturnInput = z.infer<typeof HotelEquipmentReturnDto>;
