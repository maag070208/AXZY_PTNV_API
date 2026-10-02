import { round3 } from "./fefo";

export type StockStatus = "LOW" | "OK" | "OVER";
export const STOCK_STATUSES: readonly StockStatus[] = ["LOW", "OK", "OVER"];

export type LotStatus = "VALID" | "EXPIRING" | "EXPIRED" | "EMPTY";
export const LOT_STATUSES: readonly LotStatus[] = ["VALID", "EXPIRING", "EXPIRED", "EMPTY"];

/** Bajo mínimo (reabastecer), sobre máximo (aviso) o en rango. */
export const stockStatus = (available: number, minStock: number, maxStock: number | null): StockStatus => {
  if (available < minStock) return "LOW";
  if (maxStock !== null && available > maxStock) return "OVER";
  return "OK";
};

/**
 * Sugerido a pedir para llegar al máximo; sin máximo, al doble del mínimo.
 * 0 si no hace falta. En unidades discretas (`whole`, p. ej. pieza o caja) se
 * redondea hacia arriba.
 */
export const suggestedQuantity = (
  available: number,
  minStock: number,
  maxStock: number | null,
  unit: { whole: boolean }
): number => {
  const target = maxStock ?? minStock * 2;
  const raw = Math.max(0, target - available);
  return unit.whole ? Math.ceil(raw) : round3(raw);
};

/** Suma días a una clave `YYYY-MM-DD` (calendario, sin zona). */
export const addDays = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Estado de un lote respecto a hoy y a los días de aviso de caducidad. */
export const lotStatus = (onHand: number, expiresOn: string | null, today: string, warningDays: number): LotStatus => {
  if (onHand <= 0) return "EMPTY";
  if (expiresOn === null) return "VALID";
  if (expiresOn < today) return "EXPIRED";
  if (expiresOn <= addDays(today, warningDays)) return "EXPIRING";
  return "VALID";
};
