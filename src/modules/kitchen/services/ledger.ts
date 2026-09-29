import type { KitchenMovementType } from "@prisma/client";

/**
 * Regla única del kardex de cocina: cuánto suma (+) o resta (−) cada tipo de
 * movimiento a la existencia (`onHand`) del lote. La usan el servicio al
 * registrar y el auditor al conciliar, para que nunca difieran.
 *
 * Las cantidades de las líneas son siempre positivas; el signo lo da el tipo.
 * Una reversión aplica lo contrario de su movimiento origen.
 */
export const kitchenLedgerSign = (type: KitchenMovementType, reversalOf?: KitchenMovementType): 1 | -1 => {
  switch (type) {
    case "STOCK_IN":
    case "ADJUSTMENT_IN":
      return 1;
    case "CONSUMPTION":
    case "WASTE":
    case "ADJUSTMENT_OUT":
      return -1;
    case "REVERSAL":
      if (!reversalOf || reversalOf === "REVERSAL") throw new Error("REVERSAL requires a non-reversal source type");
      return kitchenLedgerSign(reversalOf) === 1 ? -1 : 1;
  }
};
