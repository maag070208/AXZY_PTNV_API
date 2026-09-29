/**
 * Reparto FEFO (primero en caducar, primero en salir) de una cantidad entre
 * los lotes de un artículo. Puro: no toca la base.
 *
 * Orden: caducidad más próxima primero; los lotes sin caducidad al final;
 * entre iguales, el recibido antes. `includeExpired` solo aplica a mermas:
 * un consumo nunca toma lotes caducados.
 */
export interface FefoLot {
  id: string;
  lotCode: string;
  /** Día de caducidad `YYYY-MM-DD` (null = no caduca). */
  expiresOn: string | null;
  receivedAt: Date;
  onHand: number;
}

export interface FefoAllocation {
  lotId: string;
  lotCode: string;
  expiresOn: string | null;
  quantity: number;
}

export interface FefoResult {
  allocations: FefoAllocation[];
  /** Lo que no alcanzó a cubrirse con los lotes disponibles (0 = completo). */
  missing: number;
}

/** Redondeo a 3 decimales (la precisión de `Decimal(12,3)`). */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export const isExpired = (expiresOn: string | null, today: string): boolean =>
  expiresOn !== null && expiresOn < today;

export const allocateFefo = (
  lots: FefoLot[],
  quantity: number,
  today: string,
  { includeExpired = false }: { includeExpired?: boolean } = {}
): FefoResult => {
  const usable = lots
    .filter((l) => l.onHand > 0 && (includeExpired || !isExpired(l.expiresOn, today)))
    .sort((a, b) => {
      if (a.expiresOn !== b.expiresOn) {
        if (a.expiresOn === null) return 1;
        if (b.expiresOn === null) return -1;
        return a.expiresOn < b.expiresOn ? -1 : 1;
      }
      return a.receivedAt.getTime() - b.receivedAt.getTime();
    });

  const allocations: FefoAllocation[] = [];
  let remaining = round3(quantity);
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = round3(Math.min(lot.onHand, remaining));
    allocations.push({ lotId: lot.id, lotCode: lot.lotCode, expiresOn: lot.expiresOn, quantity: take });
    remaining = round3(remaining - take);
  }
  return { allocations, missing: Math.max(0, remaining) };
};
