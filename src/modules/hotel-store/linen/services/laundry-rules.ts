import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras del proceso de lavandería (Etapa 3). Las etapas son las ubicaciones del
 * almacén LAUNDRY; sin acceso a base de datos.
 */

export const LAUNDRY_STAGES = ["DIRTY", "IN_PROCESS", "CLEAN", "QUARANTINE"] as const;
export type LaundryStage = (typeof LAUNDRY_STAGES)[number];

export const PROCESS_FROM_STAGES = ["DIRTY", "IN_PROCESS", "QUARANTINE"] as const;
export const PROCESS_TO_STAGES = ["IN_PROCESS", "CLEAN", "QUARANTINE"] as const;
export const TREATMENTS = ["ORDINARY", "STAIN"] as const;
export type LaundryTreatment = (typeof TREATMENTS)[number];

/**
 * Transiciones válidas: sucio entra a proceso o a cuarentena; lo en proceso queda limpio o va a
 * cuarentena; lo de cuarentena vuelve a proceso (reparado). Nada sale limpio de regreso.
 */
const TRANSITIONS: Record<string, readonly LaundryStage[]> = {
  DIRTY: ["IN_PROCESS", "QUARANTINE"],
  IN_PROCESS: ["CLEAN", "QUARANTINE"],
  QUARANTINE: ["IN_PROCESS"],
};

export const isValidTransition = (from: string, to: string): boolean => TRANSITIONS[from]?.includes(to as LaundryStage) ?? false;

export const assertStageTransition = (from: string, to: string): void => {
  if (!isValidTransition(from, to)) throw new HttpError(409, "HOTEL_LAUNDRY_STAGE_INVALID", { from, to });
};

/** Ciclos promedio por pieza de un lote: Σ lavadas ÷ cantidad inicial (0 si el lote no tiene inicial). */
export const averageCycles = (washedQuantity: number, initialQuantity: number): number =>
  initialQuantity > 0 ? Math.round((washedQuantity / initialQuantity) * 100) / 100 : 0;
