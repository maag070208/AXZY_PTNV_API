/** Reglas puras de la reposición por dotación (sin base de datos). */

export const RESTOCK_FACTOR_MIN = 1;
export const RESTOCK_FACTOR_MAX = 5;

/** Factor de reposición: entero 1–5 (sin valor = 1). `null` si es inválido. */
export const parseRestockFactor = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < RESTOCK_FACTOR_MIN || n > RESTOCK_FACTOR_MAX) return null;
  return n;
};

/** Suma los esperados por producto de varias habitaciones. */
export const sumExpected = (perRoom: Array<Map<string, number>>): Map<string, number> => {
  const out = new Map<string, number>();
  for (const room of perRoom) for (const [productId, qty] of room) out.set(productId, (out.get(productId) ?? 0) + qty);
  return out;
};

export interface RestockInput {
  /** Σ esperado por habitación (factor 1). */
  expected: number;
  factor: number;
  /** Existencia del área sin el sucio. */
  onHand: number;
  /** Traspasos en tránsito + pendiente de pedidos abiertos. */
  incoming: number;
}

export interface RestockLine {
  target: number;
  onHand: number;
  incoming: number;
  deficit: number;
}

/** Déficit = max(0, objetivo − (tiene + en camino)), con objetivo = esperado × factor. */
export const restockLine = (input: RestockInput): RestockLine => {
  const target = input.expected * input.factor;
  return { target, onHand: input.onHand, incoming: input.incoming, deficit: Math.max(0, target - (input.onHand + input.incoming)) };
};
