import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const CartaItemInputSchema = registry.register(
  "CartaItemInput",
  z.object({
    deviceId: z.string().optional(),
    descripcion: z.string().optional(),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    numeroSerie: z.string().optional(),
    nombreEquipo: z.string().optional(),
    controlActivos: z.string().optional(),
    area: z.string().optional(),
  })
);

export const CartaCreateInputSchema = registry.register(
  "CartaCreateInput",
  z.object({
    consecutivo: z.string().optional(),
    fecha: z.string().optional(),
    numeroEmpleado: z.string().optional(),
    empresa: z.string().optional(),
    departamento: z.string().optional(),
    areaBoss: z.string().optional(),
    deliveryBy: z.string().optional(),
    responsableId: z.string().optional().nullable(),
    encargadoId: z.string().optional().nullable(),
    departmentId: z.string().optional().nullable(),
    item: CartaItemInputSchema,
  })
);

export const CartaUpdateInputSchema = registry.register(
  "CartaUpdateInput",
  CartaCreateInputSchema.extend({}).partial()
);

export const CartaReturnInputSchema = registry.register(
  "CartaReturnInput",
  z.object({
    returnedBy: z.string().min(1, "Nombre requerido"),
    returnCondition: z.string().min(1, "Condiciones requeridas"),
  })
);

export const CartaGenerateInputSchema = registry.register(
  "CartaGenerateInput",
  z.object({
    typeId: z.string().min(1, "Tipo requerido"),
  })
);

export const CartaSchema = registry.register(
  "Carta",
  z
    .object({
      id: z.string(),
      consecutive: z.string(),
      fecha: z.string(),
      numeroEmpleado: z.string(),
      empresa: z.string().nullable(),
      departamento: z.string().nullable(),
      areaBoss: z.string().nullable(),
      deliveryBy: z.string().nullable(),
      returnDate: z.string().nullable(),
      returnedBy: z.string().nullable(),
      returnCondition: z.string().nullable(),
      responsableId: z.string().nullable(),
      encargadoId: z.string().nullable(),
      departmentId: z.string().nullable(),
      creadoPorId: z.string().nullable(),
      creadoEn: z.string(),
      items: z.array(z.record(z.string(), z.unknown())).optional(),
      creadoPor: z.record(z.string(), z.unknown()).nullable().optional(),
      responsable: z.record(z.string(), z.unknown()).nullable().optional(),
      encargado: z.record(z.string(), z.unknown()).nullable().optional(),
      department: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .openapi("Carta")
);

export const CartaTableResponseSchema = paginatedTableResponseSchema(CartaSchema, "CartaTableResponse");

export const CartaQueryListSchema = TableQuerySchema;

export const ConsecutivoStateSchema = registry.register(
  "ConsecutivoState",
  z.object({
    prefijo: z.string(),
    contador: z.number(),
    siguiente: z.string(),
  })
);

export const ConsecutivoPeekSchema = registry.register(
  "ConsecutivoPeek",
  z.object({
    siguiente: z.string(),
  })
);

export const CartaGeneratedSchema = registry.register(
  "CartaGenerated",
  z
    .object({
      tipo: z
        .object({
          code: z.string(),
          name: z.string(),
          prefix: z.string(),
        })
        .openapi("CartaGeneratedTipo"),
      contador: z.number(),
      carta: CartaSchema,
    })
    .openapi("CartaGenerated")
);