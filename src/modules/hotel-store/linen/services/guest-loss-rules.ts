import { HttpError } from "@core/middlewares/error.middleware";

/** Reglas puras de las pérdidas por huésped (baja motivo G). Sin acceso a base de datos. */

export const CHARGE_STATUSES = ["NOT_CHARGED", "PENDING", "CHARGED", "WAIVED"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Cobro sugerido: costo unitario × piezas de cada renglón (editable por quien captura). */
export const suggestedChargeAmount = (lines: Array<{ quantity: number; unitCost: number | null }>): number =>
  round2(lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0));

/**
 * Cobro a guardar. Hoy no se cobra (NOT_CHARGED / WAIVED aceptan monto vacío); PENDING y CHARGED
 * exigen monto > 0 y, si no vino, se usa el sugerido. El monto nunca es negativo.
 */
export const resolveCharge = (
  status: ChargeStatus | undefined,
  amount: number | null | undefined,
  suggested: number
): { chargeStatus: ChargeStatus; chargeAmount: number | null } => {
  const chargeStatus = status ?? "NOT_CHARGED";
  if (amount !== null && amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    throw new HttpError(422, "HOTEL_GUEST_LOSS_CHARGE_INVALID");
  }
  const needsAmount = chargeStatus === "PENDING" || chargeStatus === "CHARGED";
  const chargeAmount = amount ?? (needsAmount ? suggested : null);
  if (needsAmount && !(chargeAmount !== null && chargeAmount > 0)) throw new HttpError(422, "HOTEL_GUEST_LOSS_CHARGE_INVALID");
  return { chargeStatus, chargeAmount: chargeAmount === null ? null : round2(chargeAmount) };
};

/** Nombre del huésped: obligatorio, sin espacios sobrantes. */
export const normalizeGuestName = (name: string | null | undefined): string => {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) throw new HttpError(422, "HOTEL_GUEST_LOSS_GUEST_REQUIRED");
  return clean;
};

/** Piezas pendientes de un préstamo (prestadas − devueltas). */
export const unreturnedQty = (quantity: number, returnedQty: number): number => round3(Math.max(0, quantity - returnedQty));

/** Un vínculo previo solo bloquea si su baja sigue viva; una baja rechazada permite volver a convertir. */
export const assertNotConverted = (linkedStatus: string | null | undefined): void => {
  if (linkedStatus && linkedStatus !== "CANCELLED") throw new HttpError(409, "HOTEL_GUEST_LOSS_ALREADY_CONVERTED");
};

/** Solo un préstamo UNRETURNED con piezas pendientes se convierte. */
export const assertLoanConvertible = (status: string, pending: number): void => {
  if (status !== "UNRETURNED" || pending <= 0) throw new HttpError(409, "HOTEL_GUEST_LOSS_SOURCE_INVALID");
};

/** Solo un adicional MISSING con faltante se convierte. */
export const assertExtraConvertible = (status: string, missingQty: number): void => {
  if (status !== "MISSING" || missingQty <= 0) throw new HttpError(409, "HOTEL_GUEST_LOSS_SOURCE_INVALID");
};

export interface FallbackCandidate {
  id: string;
  status: string;
  guestName: string | null;
  notes: string | null;
}

/**
 * Baja F que el sistema ya generó para el faltante (corte de turno / recolección): se reclasifica a G
 * en lugar de crear otra y duplicar la salida de stock. Vive y sin huésped; si hay folio, debe aparecer
 * en sus notas (un corte genera una baja por préstamo).
 */
export const pickWriteoffToReclassify = (candidates: FallbackCandidate[], folio?: string): FallbackCandidate | null =>
  candidates.find(
    (c) => (c.status === "PENDING_APPROVAL" || c.status === "ACTIVE") && c.guestName === null && (!folio || (c.notes ?? "").includes(folio))
  ) ?? null;

// ── Reporte ──────────────────────────────────────────────────────────────────

export interface GuestLossTotalsRow {
  status: string;
  chargeStatus: string;
  pieces: number;
  cost: number;
  chargeAmount: number | null;
}

/** Totales del reporte: las rechazadas (CANCELLED) no suman. Por estado de cobro y gran total. */
export const aggregateGuestLosses = (rows: GuestLossTotalsRow[]) => {
  const counted = rows.filter((r) => r.status !== "CANCELLED");
  const byChargeStatus = CHARGE_STATUSES.map((status) => {
    const mine = counted.filter((r) => r.chargeStatus === status);
    return {
      status,
      events: mine.length,
      pieces: round3(mine.reduce((s, r) => s + r.pieces, 0)),
      cost: round2(mine.reduce((s, r) => s + r.cost, 0)),
      chargeAmount: round2(mine.reduce((s, r) => s + (r.chargeAmount ?? 0), 0)),
    };
  });
  return {
    byChargeStatus,
    total: {
      events: counted.length,
      pieces: round3(counted.reduce((s, r) => s + r.pieces, 0)),
      cost: round2(counted.reduce((s, r) => s + r.cost, 0)),
      chargeAmount: round2(counted.reduce((s, r) => s + (r.chargeAmount ?? 0), 0)),
    },
  };
};
