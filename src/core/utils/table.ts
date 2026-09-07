import { z } from "zod";

/**
 * Contrato compartido con el componente ITDataTable del frontend.
 * El frontend hace POST { page, limit, filters, sort } y espera { data, total }.
 */
export interface ITDataTableFetchParams {
  page: number;
  limit: number;
  filters: Record<string, string | number | boolean>;
  sort?: {
    key: string;
    direction: "asc" | "desc";
  };
}

export interface ITDataTableResponse<T> {
  data: T[];
  total: number;
}

const paramsSchema = z.object({
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
});

export const parseTableParams = (body: unknown): ITDataTableFetchParams => {
  const parsed = paramsSchema.safeParse(body);
  const b = parsed.success ? parsed.data : {};

  const filters: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(b.filters ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    filters[key] = value;
  }

  return {
    page: b.page ?? 1,
    limit: b.limit ?? 10,
    filters,
    sort: b.sort ?? undefined,
  };
};

/** Filtro Prisma "contains" case-insensitive (para campos de texto). */
export const ci = (
  value: unknown
): { contains: string; mode: "insensitive" } | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  return { contains: String(value), mode: "insensitive" };
};

/** Convierte { key, direction } del frontend a orderBy de Prisma, validando contra un allowlist. */
export const orderByOf = (
  sort: ITDataTableFetchParams["sort"] | undefined,
  map: Record<string, string | ((direction: "asc" | "desc") => unknown)>,
  fallback: unknown[]
): unknown[] => {
  if (sort && map[sort.key]) {
    const spec = map[sort.key];
    if (typeof spec === "function") {
      return [spec(sort.direction)];
    }
    return [{ [spec]: sort.direction }];
  }
  return fallback;
};