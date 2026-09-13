import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const SublugarSchema = z
  .object({
    id: z.string(),
    locationId: z.string(),
    name: z.string(),
    numero: z.string().nullish(),
    active: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Sublugar");

export type Sublugar = z.infer<typeof SublugarSchema>;

export const LocationSchema = z
  .object({
    id: z.string(),
    lugar: z.string(),
    active: z.boolean(),
    descripcion: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    sublugares: z.array(SublugarSchema).optional(),
    _count: z.object({ devices: z.number(), cartas: z.number() }).optional(),
    devices: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .openapi("Location");

export type Location = z.infer<typeof LocationSchema>;

export const LocationCreateDto = z
  .object({
    lugar: z.string().trim().min(1).max(80),
    descripcion: z.string().max(255).optional(),
  })
  .openapi("LocationCreateInput");

export type LocationCreateInput = z.infer<typeof LocationCreateDto>;

export const LocationUpdateDto = z
  .object({
    lugar: z.string().trim().min(1).max(80).optional(),
    descripcion: z.string().max(255).optional(),
    active: z.boolean().optional(),
  })
  .openapi("LocationUpdateInput");

export type LocationUpdateInput = z.infer<typeof LocationUpdateDto>;

export const SublugarCreateDto = z
  .object({
    name: z.string().trim().min(1).max(80),
    numero: z.string().max(20).optional(),
  })
  .openapi("SublugarCreateInput");

export type SublugarCreateInput = z.infer<typeof SublugarCreateDto>;

export const DeleteSuccessSchema = z
  .object({ success: z.boolean() })
  .openapi("DeleteSuccess");

export const DeleteLocationResponseSchema = z
  .object({
    soft: z.boolean(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("DeleteLocationResponse");

export const LocationTableResponseSchema = paginatedTableResponseSchema(
  LocationSchema,
  "LocationTableResponse"
);

registry.register("Location", LocationSchema);
registry.register("LocationCreateInput", LocationCreateDto);
registry.register("LocationUpdateInput", LocationUpdateDto);
registry.register("Sublugar", SublugarSchema);
registry.register("SublugarCreateInput", SublugarCreateDto);
registry.register("DeleteSuccess", DeleteSuccessSchema);
registry.register("DeleteLocationResponse", DeleteLocationResponseSchema);