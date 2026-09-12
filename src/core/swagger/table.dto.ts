import { z, registry } from "./registry";

export const TableQuerySchema = z
  .object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    filters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .nullish(),
    sort: z
      .object({
        key: z.string().min(1),
        direction: z.enum(["asc", "desc"]),
      })
      .nullish(),
  })
  .openapi("TableQuery");

registry.register("TableQuery", TableQuerySchema);

export const TablePaginationFieldsSchema = z
  .object({
    page: z.number(),
    pageIndex: z.number(),
    totalPages: z.number(),
    totalCount: z.number(),
    limit: z.number(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
  })
  .openapi("TablePagination");

registry.register("TablePagination", TablePaginationFieldsSchema);

/**
 * Registra un schema de respuesta paginada (data + total + 7 campos de paginación).
 * El schema se registra con `name` en el registry de Swagger.
 */
export const paginatedTableResponseSchema = <T extends z.ZodType>(
  itemSchema: T,
  name: string
) =>
  registry.register(
    name,
    z
      .object({
        data: z.array(itemSchema),
        total: z.number(),
        page: z.number(),
        pageIndex: z.number(),
        totalPages: z.number(),
        totalCount: z.number(),
        limit: z.number(),
        hasPreviousPage: z.boolean(),
        hasNextPage: z.boolean(),
      })
      .openapi(name)
  );