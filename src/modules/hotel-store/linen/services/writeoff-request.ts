import type { Prisma } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";
import { assertMovementShape } from "../../services/kardex-rules";
import { HotelMovementService } from "../../services/movement.service";
import { locationIdsOf } from "./linen-locations";
import { WRITEOFF_DOC, type ReasonCode } from "./writeoff-rules";

export interface LinenWriteoffRequestInput {
  warehouseId: string;
  /** Ubicación de la que sale la pieza; sin ella, QUARANTINE del almacén (si no existe, la de cada renglón). */
  locationId?: string | null;
  reasonCode: ReasonCode;
  lines: Array<{ productId: string; lotId?: string | null; quantity: number; locationId?: string | null }>;
  notes?: string | null;
  /** Quien solicita (queda como creador y firma "solicita"). */
  actorId: string;
  /** Documento que origina la baja (conteo, faltante...). */
  sourceDocId?: string | null;
  stocktakeId?: string | null;
  movements?: HotelMovementService;
}

let defaultMovements: HotelMovementService | null = null;

/**
 * Crea UNA baja de blancos pendiente de aprobación (D9) dentro de la transacción de quien llama:
 * no mueve stock hasta que se autoriza, pero reserva los lotes (FIFO o el indicado) y valida que
 * hay existencia. No exige foto: la regla de fotos la aplica el endpoint de solicitud, así que
 * otras fases (faltantes F4, conteo E) pueden usarla sin evidencia.
 */
export const createLinenWriteoffRequest = async (tx: Prisma.TransactionClient, input: LinenWriteoffRequestInput) => {
  const reason = await tx.hotelReason.findFirst({
    where: { kind: "WRITE_OFF", code: input.reasonCode, active: true },
    select: { id: true },
  });
  if (!reason) throw new HttpError(422, "HOTEL_WRITEOFF_REASON_MISSING");

  const products = await tx.hotelProduct.findMany({
    where: { id: { in: input.lines.map((l) => l.productId) } },
    select: { id: true, kind: true },
  });
  if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
  if (products.some((p) => p.kind !== "LINEN")) throw new HttpError(422, "HOTEL_WRITEOFF_PRODUCT_NOT_LINEN");

  const quarantine = (await locationIdsOf(tx, input.warehouseId)).get("QUARANTINE") ?? null;
  const movementInput = {
    type: "WRITE_OFF" as const,
    fromWarehouseId: input.warehouseId,
    reasonId: reason.id,
    notes: input.notes ?? null,
    forcePending: true,
    stocktakeId: input.stocktakeId ?? null,
    sourceDocType: WRITEOFF_DOC,
    sourceDocId: input.sourceDocId ?? null,
    lines: input.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      lotId: l.lotId ?? null,
      fromLocationId: l.locationId ?? input.locationId ?? quarantine,
    })),
  };
  assertMovementShape("WRITE_OFF", movementInput);
  const movements = input.movements ?? (defaultMovements ??= new HotelMovementService());
  const created = await movements.applyInTransaction(tx, movementInput, input.actorId, null);
  await tx.hotelSignature.create({
    data: { docType: WRITEOFF_DOC, docId: created.id, role: "DELIVERS", userId: input.actorId, method: "SESSION" },
  });
  return created;
};
