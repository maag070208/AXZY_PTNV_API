import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Valor de un filtro de columna: escalar (texto, número, booleano, id de
 * catálogo) o rango de fechas `[desde, hasta]` en ISO (un extremo puede ser
 * `null`). La web convierte los filtros de fecha y rango de ITDataTable a este
 * rango con los límites del día local y su zona ("2026-09-19T00:00:00.000-07:00",
 * `tableRequest`): el instante sirve a columnas con hora y los primeros 10
 * caracteres son el día del calendario para columnas de solo fecha.
 */
export type TableFilterValue = string | number | boolean | [string | null, string | null];
export type TableFilters = Record<string, TableFilterValue>;

/**
 * Contrato compartido con el componente ITDataTable del frontend.
 * El frontend hace POST { page, limit, filters, sort } y espera { data, total }.
 */
export interface ITDataTableFetchParams {
  page: number;
  limit: number;
  filters: TableFilters;
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

/** `[desde, hasta]` con al menos un extremo (strings; el otro puede ser null/""). */
const isRange = (value: unknown): value is [string | null, string | null] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((v) => v === null || typeof v === "string") &&
  value.some((v) => typeof v === "string" && v !== "");

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

  const filters: TableFilters = {};
  if (isPlainObject(b.filters)) {
    for (const [key, value] of Object.entries(b.filters)) {
      if (value === null || value === undefined || value === "") continue;
      // Conserva `0` y `false`; descarta objetos y arrays que no sean rango.
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        filters[key] = value;
      } else if (isRange(value)) {
        filters[key] = [value[0] || null, value[1] || null];
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
// --- lectura validada de filtros ----------------------------------------------
// Un filtro con un valor que la columna no admite es un error del cliente
// (400 INVALID_FILTER), no un 500 de Prisma ni un filtro ignorado en silencio.


const invalidFilter = (field: string) => new HttpError(400, "INVALID_FILTER", { field });

/** Id o texto exacto (catálogos). */
export const filterId = (filters: TableFilters, key: string): string | undefined => {
  const value = filters[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalidFilter(key);
  return value;
};

/** Valor de un conjunto cerrado (enums de Prisma). */
export const filterEnum = <T extends string>(
  filters: TableFilters,
  key: string,
  values: readonly T[]
): T | undefined => {
  const value = filterId(filters, key);
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) throw invalidFilter(key);
  return value as T;
};

/** Sí/no: acepta `true`/`false` o sus textos (los catálogos mandan "true"/"false"). */
export const filterBool = (filters: TableFilters, key: string): boolean | undefined => {
  const value = filters[key];
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalidFilter(key);
};

/** Valor exacto sin distinguir mayúsculas (catálogos de texto: la opción ES el valor guardado). */
export const filterExact = (filters: TableFilters, key: string) => {
  const value = filterId(filters, key);
  return value === undefined ? undefined : { equals: value, mode: "insensitive" as const };
};

/** Texto libre: "contains" case-insensitive. */
export const filterText = (filters: TableFilters, key: string) => {
  const value = filters[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") throw invalidFilter(key);
  return ci(value);
};

const rangeOf = (
  filters: TableFilters,
  key: string,
  parse: (v: string) => Date
): { gte?: Date; lte?: Date } | undefined => {
  const value = filters[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalidFilter(key);
  const [from, to] = value.map((v) => {
    if (v === null) return undefined;
    const date = parse(v);
    if (Number.isNaN(date.getTime())) throw invalidFilter(key);
    return date;
  });
  if (from && to && from > to) throw new HttpError(400, "INVALID_RANGE");
  return { ...(from && { gte: from }), ...(to && { lte: to }) };
};

/** Rango de instantes `[desde, hasta]` (inclusivo) → `{ gte, lte }` de Prisma (columnas con hora). */
export const filterDateRange = (filters: TableFilters, key: string) => rangeOf(filters, key, (v) => new Date(v));

/**
 * Rango de días del calendario para columnas de solo fecha (`@db.Date`): toma
 * el día tal como lo eligió el usuario (primeros 10 caracteres del ISO local),
 * sin convertir a UTC, que lo correría un día.
 */
export const filterDayRange = (filters: TableFilters, key: string) =>
  rangeOf(filters, key, (v) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : new Date(NaN)));
