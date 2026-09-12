import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const MaterialOutputInputSchema = registry.register(
  "MaterialOutputInput",
  z.object({
    fecha: z.string().optional(),
    descripcion: z.string().min(1),
    modelo: z.string().optional(),
    marca: z.string().optional(),
    proyecto: z.string().optional(),
    cantidad: z.number().int().min(1).optional(),
    departamento: z.string().min(1),
    usuario: z.string().min(1),
    observaciones: z.string().optional(),
    area: z.string().optional(),
    deviceId: z.string().optional(),
  })
);

export const MaterialOutputBatchInputSchema = registry.register(
  "MaterialOutputBatchInput",
  z.object({
    rows: z.array(MaterialOutputInputSchema).min(1).max(200),
  })
);

export const MaterialOutputUpdateInputSchema = registry.register(
  "MaterialOutputUpdateInput",
  MaterialOutputInputSchema.extend({}).partial()
);

export const MaterialOutputSchema = registry.register(
  "MaterialOutput",
  z.object({
    id: z.string(),
    fecha: z.string(),
    descripcion: z.string(),
    modelo: z.string().nullable(),
    marca: z.string().nullable(),
    proyecto: z.string().nullable(),
    cantidad: z.number(),
    departamento: z.string(),
    usuario: z.string(),
    observaciones: z.string().nullable(),
    area: z.string(),
    deviceId: z.string().nullable(),
    registradoPorId: z.string().nullable(),
    registradoPor: z
      .object({
        id: z.string(),
        name: z.string(),
        username: z.string(),
      })
      .nullable()
      .optional(),
    device: z
      .object({
        id: z.string(),
        controlActivos: z.string(),
      })
      .nullable()
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
);

export const MaterialOutputTableResponseSchema = paginatedTableResponseSchema(MaterialOutputSchema, "MaterialOutputTableResponse");

export const MaterialOutputSummarySchema = registry.register(
  "MaterialOutputSummary",
  z.object({
    departamento: z.array(z.string()),
    usuario: z.array(z.string()),
    proyecto: z.array(z.string()),
    marca: z.array(z.string()),
    modelo: z.array(z.string()),
    descripcion: z.array(z.string()),
  })
);

export const SalidaQueryListSchema = TableQuerySchema;