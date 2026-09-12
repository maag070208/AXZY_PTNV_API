import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";
import { DEVICE_FIELD_KEYS } from "../fields/device-type.fields";

const FieldSettingSchema = z
  .object({
    enabled: z.boolean(),
    required: z.boolean(),
  })
  .openapi("FieldSetting");

const FieldConfigSchema = z
  .record(z.enum(DEVICE_FIELD_KEYS), FieldSettingSchema)
  .optional()
  .openapi("DeviceFieldConfig");

export const DeviceTypeSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    prefix: z.string(),
    contador: z.number(),
    cartaContador: z.number(),
    active: z.boolean(),
    fieldConfig: FieldConfigSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    _count: z.object({ devices: z.number() }).optional(),
  })
  .openapi("DeviceType");

export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const DeviceTypeCreateDto = z
  .object({
    code: z.string().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().min(1),
    prefix: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[A-Za-z0-9]+$/, "Prefijo solo letras/números"),
    fieldConfig: FieldConfigSchema,
  })
  .openapi("DeviceTypeCreateInput");

export type DeviceTypeCreateInput = z.infer<typeof DeviceTypeCreateDto>;

export const DeviceTypeUpdateDto = z
  .object({
    name: z.string().optional(),
    prefix: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[A-Za-z0-9]+$/)
      .optional(),
    active: z.boolean().optional(),
    fieldConfig: FieldConfigSchema,
  })
  .openapi("DeviceTypeUpdateInput");

export type DeviceTypeUpdateInput = z.infer<typeof DeviceTypeUpdateDto>;

export const NextFolioSchema = z
  .object({ siguiente: z.string() })
  .openapi("NextFolio");

export const DeviceTypeTableResponseSchema = paginatedTableResponseSchema(DeviceTypeSchema, "DeviceTypeTableResponse");

registry.register("DeviceType", DeviceTypeSchema);
registry.register("DeviceTypeCreateInput", DeviceTypeCreateDto);
registry.register("DeviceTypeUpdateInput", DeviceTypeUpdateDto);
registry.register("DeviceFieldConfig", FieldConfigSchema);
registry.register("NextFolio", NextFolioSchema);