import { z } from "@core/swagger/registry";

export const HotelWarehouseKindSchema = z.enum(["ADMIN", "CENTRAL", "ZONE", "CART", "LAUNDRY"]);
export const HotelMovementTypeSchema = z.enum([
  "INITIAL_LOAD",
  "INBOUND",
  "TRANSFER",
  "ROOM_CONSUMPTION",
  "LINEN_EXCHANGE",
  "ADJUST_IN",
  "ADJUST_OUT",
  "WRITE_OFF",
]);

export const HotelWarehouseCreateDto = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  kind: HotelWarehouseKindSchema.optional(),
  zoneId: z.string().nullish(),
  ownerId: z.string().nullish(),
});
export const HotelWarehouseUpdateDto = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  zoneId: z.string().nullish(),
  active: z.boolean().optional(),
});
export type HotelWarehouseUpdateInput = z.infer<typeof HotelWarehouseUpdateDto>;

export const HotelLocationCreateDto = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().max(120).nullish(),
});

export const HotelMovementCreateDto = z.object({
  type: HotelMovementTypeSchema,
  fromWarehouseId: z.string().nullish(),
  warehouseId: z.string().nullish(),
  roomId: z.string().nullish(),
  reasonId: z.string().nullish(),
  notes: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive().max(999999999),
        unitCost: z.number().nonnegative().max(999999999).nullish(),
        fromLocationId: z.string().nullish(),
        toLocationId: z.string().nullish(),
      })
    )
    .min(1)
    .max(200),
});
export type HotelMovementCreateInput = z.infer<typeof HotelMovementCreateDto>;
