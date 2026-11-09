import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras de las bajas de blancos (D9) y el conteo A–E (D10). Sin acceso a base de datos:
 * el servicio las usa y las pruebas unitarias las cubren.
 */

export const WRITEOFF_DOC = "HOTEL_WRITEOFF";
/** Movimiento interno que aparta la pieza fisica en la cuarentena de Lavanderia. */
export const WRITEOFF_HOLD_DOC = "HOTEL_WRITEOFF_HOLD";
/** Movimiento interno que devuelve la pieza a su area cuando la baja se rechaza. */
export const WRITEOFF_RELEASE_DOC = "HOTEL_WRITEOFF_RELEASE";
export const QUARANTINE_LOCATION_CODE = "QUARANTINE";

/** Tipo real de una imagen por sus primeros bytes (no se confía en el mime del navegador). */
export const imageMimeOf = (buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null => {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
};

/** Motivos del formato semanal, en el orden de sus columnas (R rota, M mancha, D desgaste, Q quemada, F faltante). */
export const REASON_CODES = ["R", "M", "D", "Q", "F"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DISPOSITIONS = ["SECOND_LIFE", "DISPOSAL"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export interface WriteoffLineInput {
  productId: string;
  lotId?: string | null;
  quantity: number;
  reasonCode: ReasonCode;
}

/**
 * Decisión de diseño: UNA baja (movimiento WRITE_OFF) por motivo. El motivo vive en
 * `HotelMovement.reasonId`, así que el formato semanal cuenta por motivo sin columnas nuevas.
 */
export const groupByReason = <T extends { reasonCode: ReasonCode }>(lines: T[]): Map<ReasonCode, T[]> => {
  const groups = new Map<ReasonCode, T[]>();
  for (const line of lines) groups.set(line.reasonCode, [...(groups.get(line.reasonCode) ?? []), line]);
  return groups;
};

/** Motivo fisico (hay pieza): se aparta en cuarentena; F (faltante) no tiene pieza que retener. */
export const reasonRequiresHold = (code: ReasonCode): boolean => code !== "F";

/** Las fotos son obligatorias salvo cuando todos los motivos son F (faltante: no hay pieza que fotografiar). */
export const photosRequired = (codes: ReasonCode[]): boolean => codes.some((c) => c !== "F");

export const assertPhotos = (codes: ReasonCode[], photoCount: number): void => {
  if (photosRequired(codes) && photoCount < 1) throw new HttpError(422, "HOTEL_WRITEOFF_PHOTO_REQUIRED");
};

/** D9: toda baja (WRITE_OFF) que incluya blancos (LINEN) nace pendiente de aprobación, sin importar el monto. */
export const writeoffForcesPending = (type: string, productKinds: string[]): boolean =>
  type === "WRITE_OFF" && productKinds.includes("LINEN");

/** Quien solicitó no autoriza (siempre, sin importar el alcance). */
export const assertNotRequester = (requesterId: string, authorizerId: string): void => {
  if (requesterId === authorizerId) throw new HttpError(409, "HOTEL_WRITEOFF_SELF_APPROVAL");
};

/**
 * Aprobar exige revisión del Gerente Ops. Sin revisión solo pasa quien tiene alcance TODO sobre
 * la autorización; en ese caso la baja queda marcada como "sin revisión".
 */
export const assertReviewedOrOverride = (reviewed: boolean, canSkipReview: boolean): { reviewSkipped: boolean } => {
  if (reviewed) return { reviewSkipped: false };
  if (!canSkipReview) throw new HttpError(409, "HOTEL_WRITEOFF_NOT_REVIEWED");
  return { reviewSkipped: true };
};

// ── Conteo A–E ──────────────────────────────────────────────────────────────

export interface Grades {
  gradeA?: number | null;
  gradeB?: number | null;
  gradeC?: number | null;
  gradeD?: number | null;
  gradeE?: number | null;
}

const GRADE_KEYS = ["gradeA", "gradeB", "gradeC", "gradeD", "gradeE"] as const;

/** Suma de grados capturados, o null si no vino ninguno (conteo simple). */
export const sumGrades = (grades: Grades): number | null => {
  const present = GRADE_KEYS.map((k) => grades[k]).filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  for (const v of present) {
    if (!Number.isFinite(v) || v < 0) throw new HttpError(422, "HOTEL_COUNT_QUANTITY_INVALID");
  }
  return present.reduce((s, v) => s + v, 0);
};

// ── Reporte semanal (formato pág. 15) ───────────────────────────────────────

export interface WeeklyInputLine {
  productId: string;
  code: string;
  name: string;
  size?: string | null;
  reasonCode: string | null;
  quantity: number;
  unitCost: number;
}

export interface WeeklyRow {
  productId: string;
  code: string;
  name: string;
  size: string | null;
  byReason: Record<ReasonCode, number>;
  total: number;
  cost: number;
}

const emptyByReason = (): Record<ReasonCode, number> => ({ R: 0, M: 0, D: 0, Q: 0, F: 0 });

/** Matriz producto × motivo con total y costo; los motivos desconocidos solo suman al total. */
export const buildWeeklyMatrix = (lines: WeeklyInputLine[]) => {
  const rows = new Map<string, WeeklyRow>();
  const totals = { byReason: emptyByReason(), total: 0, cost: 0 };
  for (const l of lines) {
    const row = rows.get(l.productId) ?? {
      productId: l.productId, code: l.code, name: l.name, size: l.size ?? null, byReason: emptyByReason(), total: 0, cost: 0,
    };
    const code = REASON_CODES.find((c) => c === l.reasonCode);
    if (code) {
      row.byReason[code] += l.quantity;
      totals.byReason[code] += l.quantity;
    }
    row.total += l.quantity;
    row.cost += l.quantity * l.unitCost;
    totals.total += l.quantity;
    totals.cost += l.quantity * l.unitCost;
    rows.set(l.productId, row);
  }
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.size ?? "").localeCompare(b.size ?? "")), totals };
};
