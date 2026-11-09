import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras de lotes (D7). Sin acceso a base de datos: el servicio de movimientos
 * las usa dentro de su transacción y las pruebas unitarias las cubren.
 */

/** Existencia de un lote en una posición (producto + almacén + ubicación). */
export interface FifoCandidate {
  lotId: string;
  /** Fecha de entrada del lote: el más viejo sale primero. */
  receivedAt: Date | number;
  /** Desempate estable cuando dos lotes entraron al mismo instante. */
  code?: string;
  available: number;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
}

const EPSILON = 1e-9;

const timeOf = (value: Date | number): number => (value instanceof Date ? value.getTime() : value);

/**
 * Reparte `required` entre los lotes por FIFO (receivedAt ascendente). Devuelve las
 * asignaciones y lo que no alcanzó a cubrirse (`remaining` > 0 = existencia insuficiente).
 * Ignora lotes sin saldo. No modifica la entrada.
 */
export const allocateFifo = (
  candidates: FifoCandidate[],
  required: number
): { allocations: LotAllocation[]; remaining: number } => {
  const ordered = candidates
    .filter((c) => c.available > EPSILON)
    .sort((a, b) => timeOf(a.receivedAt) - timeOf(b.receivedAt) || (a.code ?? a.lotId).localeCompare(b.code ?? b.lotId));
  const allocations: LotAllocation[] = [];
  let remaining = required;
  for (const candidate of ordered) {
    if (remaining <= EPSILON) break;
    const take = Math.min(candidate.available, remaining);
    allocations.push({ lotId: candidate.lotId, quantity: take });
    remaining -= take;
  }
  return { allocations, remaining: remaining <= EPSILON ? 0 : remaining };
};

/** `AAAAMMDD` de una fecha (hora local del servidor). */
export const lotDatePrefix = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
};

/** Código de lote `AAAAMMDD-n`, n = consecutivo del producto ese día. */
export const lotCode = (date: Date, sequence: number): string => `${lotDatePrefix(date)}-${sequence}`;

/** Cantidad pedida contra saldo de un lote indicado explícitamente. */
export const assertLotCovers = (productId: string, lotId: string, available: number, required: number): void => {
  if (available + EPSILON < required) {
    throw new HttpError(409, "HOTEL_STOCK_INSUFFICIENT", { productId, lotId, available, required });
  }
};
