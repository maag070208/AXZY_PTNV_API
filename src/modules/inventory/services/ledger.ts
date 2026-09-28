import type { Condition, MovementType } from "../models/entity/inventory.entity";

/**
 * Regla única del kardex: cuánto cambia la existencia DISPONIBLE de un
 * dispositivo con cada renglón de movimiento. La usan el kardex
 * (`stockLedger`) y el auditor (kardex contra unidades AVAILABLE), así que
 * sumar los deltas de todos los movimientos debe dar exactamente las unidades
 * disponibles.
 *
 * - Altas (STOCK_IN, ADJUSTMENT_IN): +q. Préstamo y entrada a mantenimiento: −q.
 * - Devolución y salida de mantenimiento: +q, salvo condición POOR (la unidad
 *   queda DAÑADA, no disponible). BROKEN suma porque la baja automática que la
 *   acompaña (RETIREMENT, condición BROKEN) la resta.
 * - Baja (RETIREMENT, ADJUSTMENT_OUT): −q, salvo condición POOR (se da de baja
 *   una unidad DAÑADA, que ya no contaba como disponible).
 * - Traspaso: 0 (solo cambia el departamento).
 * - Reversión: lo contrario del movimiento que revierte (`sourceType`), con la
 *   misma condición del renglón.
 */
export const ledgerDelta = (
  type: MovementType,
  quantity: number,
  condition: Condition | null | undefined,
  sourceType?: MovementType | null
): number => {
  switch (type) {
    case "STOCK_IN":
    case "ADJUSTMENT_IN":
      return quantity;
    case "LOAN":
    case "MAINTENANCE_IN":
      return -quantity;
    case "RETURN":
    case "MAINTENANCE_OUT":
      return condition === "POOR" ? 0 : quantity;
    case "RETIREMENT":
    case "ADJUSTMENT_OUT":
      return condition === "POOR" ? 0 : -quantity;
    case "TRANSFER":
      return 0;
    case "REVERSAL": {
      if (!sourceType || sourceType === "REVERSAL") return 0;
      // `0 - x` y no `-x`: sin -0 cuando el origen no movió disponibles.
      return 0 - ledgerDelta(sourceType, quantity, condition);
    }
  }
};
