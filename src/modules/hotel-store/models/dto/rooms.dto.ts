import { z } from "@core/swagger/registry";

export const HotelZoneKindSchema = z.enum(["EDIFICIO", "PISO", "AREA"]);
export const HotelRoomStatusSchema = z.enum([
  "LIMPIEZA",
  "INSPECCION",
  "DISPONIBLE",
  "OCUPADA",
  "MANTENIMIENTO",
  "FUERA_SERVICIO",
]);

export const HotelZoneCreateDto = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: HotelZoneKindSchema.default("PISO"),
    parentId: z.string().nullish(),
    description: z.string().trim().max(500).nullish(),
    requiresInspection: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .openapi("HotelZoneCreateInput");

export const HotelZoneUpdateDto = HotelZoneCreateDto.partial().extend({
  active: z.boolean().optional(),
});
export type HotelZoneUpdateInput = z.infer<typeof HotelZoneUpdateDto>;

export const HotelRoomTypeCreateDto = z
  .object({
    name: z.string().trim().min(1).max(120),
    beds: z.number().int().min(0).max(20).optional(),
    capacity: z.number().int().min(0).max(50).optional(),
    description: z.string().trim().max(500).nullish(),
    requiresInspection: z.boolean().optional(),
    kitId: z.string().nullish(),
    active: z.boolean().optional(),
  })
  .openapi("HotelRoomTypeCreateInput");

export const HotelRoomTypeUpdateDto = HotelRoomTypeCreateDto.partial();
export type HotelRoomTypeUpdateInput = z.infer<typeof HotelRoomTypeUpdateDto>;

export const HotelRoomCreateDto = z
  .object({
    zoneId: z.string().min(1),
    typeId: z.string().min(1),
    number: z.string().trim().min(1).max(20),
    status: z.enum(["LIMPIEZA", "DISPONIBLE"]).optional(),
    notes: z.string().trim().max(500).nullish(),
  })
  .openapi("HotelRoomCreateInput");

export const HotelRoomUpdateDto = z
  .object({
    typeId: z.string().min(1).optional(),
    number: z.string().trim().min(1).max(20).optional(),
    notes: z.string().trim().max(500).nullish(),
    active: z.boolean().optional(),
  })
  .openapi("HotelRoomUpdateInput");
export type HotelRoomUpdateInput = z.infer<typeof HotelRoomUpdateDto>;

/** Cambio de estado: la matriz vive en el servicio, no en la web. */
export const HotelRoomStatusDto = z
  .object({
    to: HotelRoomStatusSchema,
    reasonId: z.string().nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .openapi("HotelRoomStatusInput");
export type HotelRoomStatusInput = z.infer<typeof HotelRoomStatusDto>;

export const HotelRoomStatusTransitionCreateDto = z
  .object({
    from: HotelRoomStatusSchema,
    to: HotelRoomStatusSchema,
    requiresReason: z.boolean().optional(),
    requiresActiveKit: z.boolean().optional(),
    permission: z.string().trim().min(1).max(80).optional(),
    systemOnly: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .openapi("HotelRoomStatusTransitionCreateInput");

export const HotelRoomStatusTransitionUpdateDto = z
  .object({
    requiresReason: z.boolean().optional(),
    requiresActiveKit: z.boolean().optional(),
    permission: z.string().trim().min(1).max(80).optional(),
    systemOnly: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .openapi("HotelRoomStatusTransitionUpdateInput");

export const HotelReasonKindSchema = z.enum([
  "AJUSTE",
  "BAJA",
  "ESTADO_HABITACION",
  "CIERRE_OC",
  "INSPECCION",
]);

export const HotelReasonCreateDto = z
  .object({
    kind: HotelReasonKindSchema,
    name: z.string().trim().min(1).max(120),
    requiresNotes: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .openapi("HotelReasonCreateInput");

export const HotelReasonUpdateDto = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    requiresNotes: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .openapi("HotelReasonUpdateInput");
