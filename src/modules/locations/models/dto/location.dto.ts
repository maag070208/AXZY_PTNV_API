import { z, registry } from "@core/swagger/registry";

export const LocationSchema = z
  .object({
    id: z.string(),
    lugar: z.string().nullish(),
    subLugar: z.string().nullish(),
    numero: z.string().nullish(),
    descripcion: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    _count: z.object({ devices: z.number() }).optional(),
    devices: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .openapi("Location");

export type Location = z.infer<typeof LocationSchema>;

export const LocationCreateDto = z
  .object({
    lugar: z.string().optional(),
    subLugar: z.string().optional(),
    numero: z.string().optional(),
    descripcion: z.string().optional(),
  })
  .openapi("LocationCreateInput");

export type LocationCreateInput = z.infer<typeof LocationCreateDto>;

export const LocationUpdateDto = LocationCreateDto.openapi("LocationUpdateInput");
export type LocationUpdateInput = z.infer<typeof LocationUpdateDto>;

export const DeleteSuccessSchema = z
  .object({ success: z.boolean() })
  .openapi("DeleteSuccess");

registry.register("Location", LocationSchema);
registry.register("LocationCreateInput", LocationCreateDto);
registry.register("LocationUpdateInput", LocationUpdateDto);
registry.register("DeleteSuccess", DeleteSuccessSchema);