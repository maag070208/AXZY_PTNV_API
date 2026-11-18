/** Reglas puras de la revisión de habitación (sin base de datos). */

export const REVIEW_SHIFTS = ["MORNING", "AFTERNOON", "NIGHT"] as const;
export type ReviewShift = (typeof REVIEW_SHIFTS)[number];

export interface CountedInput {
  productId: string;
  counted: number;
}

export interface ReviewLineResult {
  productId: string;
  expected: number;
  counted: number;
  /** counted − expected. */
  diff: number;
  /** Artículo contado que la dotación no esperaba. */
  unexpected: boolean;
}

export interface ReviewTotals {
  expected: number;
  counted: number;
  missing: number;
  surplus: number;
}

export type ReviewErrorCode = "HOTEL_ROOM_REVIEW_COUNT_INVALID" | "HOTEL_ROOM_REVIEW_DUPLICATE";

/** Valida lo capturado: enteros ≥ 0 y sin artículos repetidos. Devuelve el primer error o null. */
export const validateCounted = (lines: CountedInput[]): { index: number; code: ReviewErrorCode } | null => {
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const l = lines[index];
    if (!Number.isInteger(l.counted) || l.counted < 0 || l.counted > 9999) return { index, code: "HOTEL_ROOM_REVIEW_COUNT_INVALID" };
    if (seen.has(l.productId)) return { index, code: "HOTEL_ROOM_REVIEW_DUPLICATE" };
    seen.add(l.productId);
  }
  return null;
};

/**
 * Contado contra esperado. Los esperados no capturados cuentan 0; un artículo contado que la
 * dotación no esperaba sale como `unexpected` (se omite si se contó 0: no aporta nada).
 */
export const buildReviewLines = (expected: Map<string, number>, counted: CountedInput[]): ReviewLineResult[] => {
  const byProduct = new Map(counted.map((c) => [c.productId, c.counted]));
  const out: ReviewLineResult[] = [];
  for (const [productId, exp] of expected) {
    const got = byProduct.get(productId) ?? 0;
    out.push({ productId, expected: exp, counted: got, diff: got - exp, unexpected: false });
  }
  for (const [productId, got] of byProduct) {
    if (expected.has(productId) || got === 0) continue;
    out.push({ productId, expected: 0, counted: got, diff: got, unexpected: true });
  }
  return out;
};

/** Totales de piezas: faltante = Σ de diferencias negativas, sobrante = Σ de positivas. */
export const reviewTotals = (lines: Array<Pick<ReviewLineResult, "expected" | "counted" | "diff">>): ReviewTotals => {
  const t: ReviewTotals = { expected: 0, counted: 0, missing: 0, surplus: 0 };
  for (const l of lines) {
    t.expected += l.expected;
    t.counted += l.counted;
    if (l.diff < 0) t.missing += -l.diff;
    else t.surplus += l.diff;
  }
  return t;
};

export interface ConsolidatedRow {
  reviewId: string;
  responsibleId: string;
  productId: string;
  expected: number;
  counted: number;
}

export interface ConsolidatedByProduct {
  productId: string;
  expected: number;
  counted: number;
  missing: number;
  surplus: number;
}

export interface ConsolidatedByResponsible {
  responsibleId: string;
  reviews: number;
  missing: number;
  surplus: number;
}

/** Consolidado por artículo (faltante/sobrante por renglón de cada revisión) y por responsable. */
export const consolidate = (rows: ConsolidatedRow[]) => {
  const byProduct = new Map<string, ConsolidatedByProduct>();
  const byResponsible = new Map<string, ConsolidatedByResponsible & { seen: Set<string> }>();
  for (const r of rows) {
    const diff = r.counted - r.expected;
    const p = byProduct.get(r.productId) ?? { productId: r.productId, expected: 0, counted: 0, missing: 0, surplus: 0 };
    p.expected += r.expected;
    p.counted += r.counted;
    if (diff < 0) p.missing += -diff;
    else p.surplus += diff;
    byProduct.set(r.productId, p);

    const u = byResponsible.get(r.responsibleId) ?? { responsibleId: r.responsibleId, reviews: 0, missing: 0, surplus: 0, seen: new Set<string>() };
    u.seen.add(r.reviewId);
    if (diff < 0) u.missing += -diff;
    else u.surplus += diff;
    byResponsible.set(r.responsibleId, u);
  }
  return {
    byProduct: [...byProduct.values()],
    byResponsible: [...byResponsible.values()].map(({ seen, ...rest }) => ({ ...rest, reviews: seen.size })),
  };
};
