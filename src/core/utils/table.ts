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

/** Respuesta de tabla paginada: `{ data, total }` (compat) + metadatos de
 * paginación (naming de ITSearchTable: pageIndex, totalPages, totalCount…). */
export interface ITDataTableResponseWithPagination<T> extends ITDataTableResponse<T> {
  page: number;
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

/** Envuelve data+total con metadatos de paginación (1-based page, 0-based pageIndex). */
export const paginatedTable = <T>(
  params: ITDataTableFetchParams,
  data: T[],
  total: number
): ITDataTableResponseWithPagination<T> => {
  const page = params.page;
  const limit = params.limit;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    data,
    total,
    page,
    pageIndex: page - 1,
    totalPages,
    totalCount: total,
    limit,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
};

/** Tamaño de página por defecto cuando el cliente no manda un `limit` válido. */
export const TABLE_DEFAULT_LIMIT = 10;

/** Tope duro de página: fuente única para el runtime y para Swagger. */
export const TABLE_MAX_LIMIT = 200;

/** Objeto plano (no `null`, no array): la forma que se espera en el body. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `sort` válido o `undefined`; no descarta el resto del body si viene mal. */
const parseSort = (value: unknown): ITDataTableFetchParams["sort"] => {
  if (!isPlainObject(value)) return undefined;
  const { key, direction } = value;
  if (typeof key !== "string" || key.trim() === "") return undefined;
  if (direction === "asc" || direction === "desc") return { key, direction };
  return undefined;
};

/**
 * Normaliza el body de una tabla server-side CAMPO POR CAMPO: un valor inválido
 * cae a su default sin perder el resto (antes un `page` mal tipado tiraba todo
 * el body y se perdían filtros y orden).
 */
export const parseTableParams = (body: unknown): ITDataTableFetchParams => {
  const b: Record<string, unknown> = isPlainObject(body) ? body : {};

  const page =
    typeof b.page === "number" && Number.isInteger(b.page) && b.page >= 1 ? b.page : 1;

  let limit = TABLE_DEFAULT_LIMIT;
  if (typeof b.limit === "number" && Number.isInteger(b.limit) && b.limit >= 1) {
    limit = Math.min(b.limit, TABLE_MAX_LIMIT);
  }

  const filters: Record<string, string | number | boolean> = {};
  if (isPlainObject(b.filters)) {
    for (const [key, value] of Object.entries(b.filters)) {
      if (value === null || value === undefined || value === "") continue;
      // Conserva `0` y `false`; descarta no primitivos (objetos, arrays).
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        filters[key] = value;
      }
    }
  }

  return { page, limit, filters, sort: parseSort(b.sort) };
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