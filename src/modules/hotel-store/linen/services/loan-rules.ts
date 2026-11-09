import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del préstamo de toallas y del corte de turno (Etapa 2, pasos 10-11 y Etapa 4,
 * pasos 3-4). Sin acceso a base de datos: los servicios las usan y las pruebas unitarias las cubren.
 */

/** Depósito por toalla si `sys_config.HOTEL_TOWEL_DEPOSIT` no existe o no es válido. */
export const DEFAULT_TOWEL_DEPOSIT = 100;
export const TOWEL_DEPOSIT_KEY = "HOTEL_TOWEL_DEPOSIT";

export const parseTowelDeposit = (value: string | null | undefined): number => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOWEL_DEPOSIT;
};

const money = (n: number) => Math.round(n * 100) / 100;
const EPSILON = 1e-9;

/** Depósito de `quantity` toallas. */
export const depositOf = (quantity: number, unit: number): number => money(quantity * unit);

export type LoanStatus = "OPEN" | "PARTIAL" | "RETURNED" | "UNRETURNED";

/** Un préstamo con toallas por devolver (abierto o parcial). */
export const isOpenLoan = (status: LoanStatus): boolean => status === "OPEN" || status === "PARTIAL";

/** La devolución va de 1 a lo que sigue prestado; más es 422. */
export const assertReturnQuantity = (pending: number, quantity: number): void => {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  if (quantity - pending > EPSILON) throw new HttpError(422, "HOTEL_LOAN_RETURN_EXCEEDS");
};

/** Estado tras devolver: todo devuelto -> RETURNED; algo -> PARTIAL. */
export const statusAfterReturn = (quantity: number, returnedQty: number): LoanStatus =>
  returnedQty + EPSILON >= quantity ? "RETURNED" : returnedQty > 0 ? "PARTIAL" : "OPEN";

/** Depósito devuelto y retenido de un préstamo: lo devuelto se reembolsa; el resto sigue en caja. */
export const depositSplit = (loan: { quantity: number; returnedQty: number; depositUnit: number }) => ({
  collected: depositOf(loan.quantity, loan.depositUnit),
  returned: depositOf(loan.returnedQty, loan.depositUnit),
  held: depositOf(Math.max(0, loan.quantity - loan.returnedQty), loan.depositUnit),
});

export interface ShiftLoan {
  id: string;
  status: LoanStatus;
  quantity: number;
  returnedQty: number;
  depositUnit: number;
}

export interface ShiftCloseTotals {
  lent: number;
  returned: number;
  unreturned: number;
  depositsCollected: number;
  depositsReturned: number;
  depositsRetained: number;
}

/**
 * Corte de un punto sobre los préstamos aún sin cortar. Entran al corte los ya devueltos y los
 * marcados como no devueltos (su depósito se retiene); los abiertos sin marcar pasan al turno
 * siguiente, completos, así que cada préstamo se corta una sola vez y siempre
 * cobrado = devuelto + retenido.
 */
export const computeShiftClose = (loans: ShiftLoan[], markedIds: string[]) => {
  const marked = new Set(markedIds);
  const byId = new Map(loans.map((l) => [l.id, l]));
  for (const id of marked) {
    const loan = byId.get(id);
    if (!loan || !isOpenLoan(loan.status)) throw new HttpError(422, "HOTEL_SHIFT_MARK_INVALID", { loanId: id });
  }
  const included: ShiftLoan[] = [];
  const carriedOver: ShiftLoan[] = [];
  for (const loan of loans) {
    if (marked.has(loan.id) || !isOpenLoan(loan.status)) included.push(loan);
    else carriedOver.push(loan);
  }
  const totals: ShiftCloseTotals = {
    lent: 0,
    returned: 0,
    unreturned: 0,
    depositsCollected: 0,
    depositsReturned: 0,
    depositsRetained: 0,
  };
  for (const loan of included) {
    const split = depositSplit(loan);
    totals.lent += loan.quantity;
    totals.returned += loan.returnedQty;
    totals.depositsCollected += split.collected;
    totals.depositsReturned += split.returned;
    if (marked.has(loan.id)) {
      totals.unreturned += Math.max(0, loan.quantity - loan.returnedQty);
      totals.depositsRetained += split.held;
    }
  }
  totals.depositsCollected = money(totals.depositsCollected);
  totals.depositsReturned = money(totals.depositsReturned);
  totals.depositsRetained = money(totals.depositsRetained);
  return { included, carriedOver, totals, markedIds: [...marked] };
};

/** Depósito en caja por método (de lo que sigue prestado). */
export const depositsByMethod = (
  loans: Array<{ depositMethod: "CASH" | "CARD" | "ROOM_CHARGE"; quantity: number; returnedQty: number; depositUnit: number }>
) => {
  const out = { CASH: 0, CARD: 0, ROOM_CHARGE: 0 };
  for (const l of loans) out[l.depositMethod] += depositOf(Math.max(0, l.quantity - l.returnedQty), l.depositUnit);
  return { CASH: money(out.CASH), CARD: money(out.CARD), ROOM_CHARGE: money(out.ROOM_CHARGE) };
};
