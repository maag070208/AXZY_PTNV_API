import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Reglas puras de la recepción de sucios (Etapa 3, paso 1): faltante, desglose por estado,
 * reparto del movimiento y destinatarios del aviso. Sin acceso a base de datos.
 */

const EPSILON = 1e-9;

/** Faltante = entregado a piso − sucio recibido − sigue en uso (nunca negativo). */
export const computeShortage = (deliveredToFloor: number, receivedDirty: number, stillInUse: number): number =>
  Math.max(0, deliveredToFloor - receivedDirty - stillInUse);

/**
 * Entregado a piso pendiente de justificar en una recepción:
 *   base − Σ(sucio recibido + sigue en uso) de las recepciones anteriores del mismo día y área,
 * donde base = recibido en el área ese día por traspasos de pedido + adicionales a habitación.
 * Así varios carros del mismo día no inflan el faltante (nunca negativo).
 */
export const remainingDelivered = (base: number, priorReceivedDirty: number, priorStillInUse: number): number =>
  Math.max(0, base - priorReceivedDirty - priorStillInUse);

/** Buen estado + manchado + roto debe sumar exactamente lo recibido sucio (422 si no). */
export const assertConditionSplit = (receivedDirty: number, good: number, stained: number, damaged: number): void => {
  for (const n of [receivedDirty, good, stained, damaged]) {
    if (!Number.isFinite(n) || n < 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
  }
  if (Math.abs(good + stained + damaged - receivedDirty) > EPSILON) throw new HttpError(422, "HOTEL_DIRTY_SPLIT_MISMATCH");
};

export interface DirtyMoveSegment {
  /** Ubicación de origen en el área. */
  from: "DIRTY" | "GENERAL";
  /** Ubicación destino en lavandería. */
  to: "DIRTY" | "QUARANTINE";
  quantity: number;
}

/**
 * Reparte lo recibido: sale primero del DIRTY del área y, si no alcanza, el resto de su GENERAL.
 * Bueno + manchado van a DIRTY de lavandería y lo roto a QUARANTINE.
 */
export const planDirtyMoves = (availableInDirty: number, good: number, stained: number, damaged: number): DirtyMoveSegment[] => {
  const destinations: Array<{ to: DirtyMoveSegment["to"]; left: number }> = [
    { to: "DIRTY", left: good + stained },
    { to: "QUARANTINE", left: damaged },
  ];
  let fromDirty = Math.max(0, availableInDirty);
  const segments: DirtyMoveSegment[] = [];
  for (const destination of destinations) {
    while (destination.left > EPSILON) {
      const from: DirtyMoveSegment["from"] = fromDirty > EPSILON ? "DIRTY" : "GENERAL";
      const take = from === "DIRTY" ? Math.min(fromDirty, destination.left) : destination.left;
      segments.push({ from, to: destination.to, quantity: take });
      destination.left -= take;
      if (from === "DIRTY") fromDirty -= take;
    }
  }
  return segments;
};

/**
 * A quién avisa un faltante: Spa -> Gerente de Operaciones; el resto -> supervisores de la zona
 * del área y Supervisora general.
 */
export const shortageRecipients = (warehouseKind: string): { zoneSupervisors: boolean; roles: string[] } =>
  warehouseKind === "SPA"
    ? { zoneSupervisors: false, roles: ["HOTEL_OPS_MANAGER"] }
    : { zoneSupervisors: true, roles: ["HOTEL_GENERAL_SUPERVISOR"] };

export const DIRTY_ORIGIN_KINDS = ["ZONE", "SPA", "POINT"];
