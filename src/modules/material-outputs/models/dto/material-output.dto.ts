import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const MaterialOutputReasonSchema = z.enum(["DAMAGED", "OBSOLETE", "LOST", "OTHER"]);

export const MaterialOutputInputSchema = registry.register(
  "MaterialOutputInput",
  z.object({
    date: z.string().optional(),
    description: z.string().min(1),
    model: z.string().optional(),
    brand: z.string().optional(),
    project: z.string().optional(),
    quantity: z.number().int().min(1).optional(),
    departmentName: z.string().min(1),
    userName: z.string().min(1),
    notes: z.string().optional(),
    area: z.string().optional(),
    reason: MaterialOutputReasonSchema.optional(),
    deviceUnitId: z.string().optional(),
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
    date: z.string(),
    description: z.string(),
    model: z.string().nullable(),
    brand: z.string().nullable(),
    project: z.string().nullable(),
    quantity: z.number(),
    departmentName: z.string(),
    userName: z.string(),
    notes: z.string().nullable(),
    area: z.string(),
    reason: MaterialOutputReasonSchema.nullable(),
    deviceUnitId: z.string().nullable(),
    registeredById: z.string().nullable(),
    registeredBy: z
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
        assetTag: z.string(),
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
    departmentName: z.array(z.string()),
    userName: z.array(z.string()),
    project: z.array(z.string()),
    brand: z.array(z.string()),
    model: z.array(z.string()),
    description: z.array(z.string()),
  })
);

export const MaterialOutputQueryListSchema = TableQuerySchema;