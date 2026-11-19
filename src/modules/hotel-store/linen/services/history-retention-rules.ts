/**
 * Reglas puras de la purga de historial de Blancos (sin base de datos).
 * Alcance: solo Blancos; el `AuditLog` general no se toca. Nunca se borran existencias
 * (`HotelStock`, `HotelLot`), catálogos ni nada abierto.
 */

export const HISTORY_RETENTION_DAYS = 60;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha límite: lo anterior a ella (estrictamente) ya cumplió la retención. */
export const retentionCutoff = (now: Date, days: number = HISTORY_RETENTION_DAYS): Date => new Date(now.getTime() - days * DAY_MS);

/** Estados terminales (cerrados) por tabla; todo lo demás se considera abierto y se conserva. */
export const PURGEABLE_MOVEMENT_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export const PURGEABLE_SUPPLY_REQUEST_STATUSES = ["RECEIVED", "CANCELLED"] as const;
export const PURGEABLE_LOAN_STATUSES = ["RETURNED"] as const;
export const PURGEABLE_EXTRA_STATUSES = ["COLLECTED", "CANCELLED"] as const;
export const PURGEABLE_STOCKTAKE_STATUSES = ["APPLIED", "CANCELLED"] as const;

type DateLike = Date | null | undefined;

/**
 * Fecha de referencia de un registro: la MÁS RECIENTE de las fechas que tenga (creación, cierre,
 * recepción, última modificación). Así nada que haya tenido actividad reciente se borra.
 * Sin ninguna fecha devuelve null (no elegible).
 */
export const referenceDate = (...dates: DateLike[]): Date | null => {
  let latest: Date | null = null;
  for (const d of dates) if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  return latest;
};

/** ¿La fecha de referencia es anterior al corte? */
export const isOlderThan = (ref: Date | null, cutoff: Date): boolean => ref !== null && ref.getTime() < cutoff.getTime();

const inSet = (value: string, set: readonly string[]) => set.includes(value);

export interface MovementCandidate {
  status: string;
  createdAt: Date;
  updatedAt: Date;
  date: Date;
  approvedAt?: Date | null;
  receivedAt?: Date | null;
  signoffAt?: Date | null;
  signoffStatus?: string | null;
  chargeStatus?: string | null;
  /** Productos de sus renglones: solo se purga si hay renglones y todos son de Blancos. */
  lineProductKinds: string[];
  /** Algo que se conserva lo referencia (lote origen, ciclo de lavado, tarea, préstamo/adicional, recepción de sucio). */
  referencedByKept: boolean;
  /** Conteo físico ligado aún abierto. */
  openStocktake: boolean;
  /** Su documento origen (baja de una retención, pedido a lavandería) sigue abierto. */
  openSourceDoc: boolean;
}

/** Movimiento cerrado de Blancos, sin pendientes y sin nada conservado que lo referencie. */
export const isMovementPurgeable = (m: MovementCandidate, cutoff: Date): boolean => {
  if (!inSet(m.status, PURGEABLE_MOVEMENT_STATUSES)) return false;
  if (m.lineProductKinds.length === 0 || m.lineProductKinds.some((k) => k !== "LINEN")) return false;
  if (m.signoffStatus === "PENDING") return false;
  if (m.chargeStatus === "PENDING") return false;
  if (m.referencedByKept || m.openStocktake || m.openSourceDoc) return false;
  return isOlderThan(referenceDate(m.createdAt, m.updatedAt, m.date, m.approvedAt, m.receivedAt, m.signoffAt), cutoff);
};

export const isSupplyRequestPurgeable = (r: { status: string; createdAt: Date; updatedAt: Date; date: Date; deliveredAt?: DateLike }, cutoff: Date): boolean =>
  inSet(r.status, PURGEABLE_SUPPLY_REQUEST_STATUSES) && isOlderThan(referenceDate(r.createdAt, r.updatedAt, r.date, r.deliveredAt), cutoff);

export const isDirtyReceiptPurgeable = (r: { createdAt: Date; date: Date }, cutoff: Date): boolean =>
  isOlderThan(referenceDate(r.createdAt, r.date), cutoff);

export const isRoomStatusChangePurgeable = (c: { createdAt: Date; isLatestOfRoom: boolean }, cutoff: Date): boolean =>
  !c.isLatestOfRoom && isOlderThan(referenceDate(c.createdAt), cutoff);

/** Cierre de turno: solo si ningún préstamo conservado depende de él. */
export const isShiftClosePurgeable = (s: { createdAt: Date; to: Date; reviewedAt?: DateLike; loanCount: number }, cutoff: Date): boolean =>
  s.loanCount === 0 && isOlderThan(referenceDate(s.createdAt, s.to, s.reviewedAt), cutoff);

/** Préstamo devuelto (PARTIAL/UNRETURNED/OPEN se conservan; UNRETURNED puede estar ligado a una pérdida). */
export const isLoanPurgeable = (l: { status: string; lentAt: Date; returnedAt?: DateLike; guestLossId?: string | null }, cutoff: Date): boolean =>
  inSet(l.status, PURGEABLE_LOAN_STATUSES) && !l.guestLossId && isOlderThan(referenceDate(l.lentAt, l.returnedAt), cutoff);

/** Adicional cerrado (recogido o cancelado) y sin pérdida por huésped ligada. */
export const isExtraPurgeable = (
  e: { status: string; requestedAt: Date; deliveredAt?: DateLike; collectedAt?: DateLike; guestLossId?: string | null },
  cutoff: Date
): boolean => inSet(e.status, PURGEABLE_EXTRA_STATUSES) && !e.guestLossId && isOlderThan(referenceDate(e.requestedAt, e.deliveredAt, e.collectedAt), cutoff);
