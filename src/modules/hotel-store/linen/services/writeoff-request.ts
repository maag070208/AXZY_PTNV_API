import type { Prisma } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";
import { assertMovementShape } from "../../services/kardex-rules";
import { HotelMovementService } from "../../services/movement.service";
import { locationIdByCode, locationIdsOf, warehouseOfKind } from "./linen-locations";
import {
  QUARANTINE_LOCATION_CODE,
  WRITEOFF_DOC,
  WRITEOFF_HOLD_DOC,
  reasonRequiresHold,
  type ReasonCode,
} from "./writeoff-rules";

export interface LinenWriteoffRequestInput {
  warehouseId: string;
  /** Ubicación de la que sale la pieza; sin ella, la de cada renglón o la default del almacén. */
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
 * Crea UNA baja de blancos pendiente de aprobación (D9) dentro de la transacción de quien llama.
 * Ajuste demo v2: si el motivo es físico (hay pieza), primero la aparta en la cuarentena de
 * Lavandería con un traspaso interno (`HOTEL_WRITEOFF_HOLD`); la baja pendiente se crea desde la
 * cuarentena y conserva el `originWarehouseId` del área. Faltante (F) no retiene nada.
 * No exige foto: la regla de fotos la aplica el endpoint de solicitud.
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

  const origin = await tx.hotelWarehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, code: true, kind: true, active: true },
  });
  if (!origin || !origin.active) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");

  const movements = input.movements ?? (defaultMovements ??= new HotelMovementService());

  // De dónde sale la baja: el área, o la cuarentena de Lavandería cuando la pieza se retiene ahí.
  let fromWarehouseId = origin.id;
  let fromLocationId: string | null = input.locationId ?? null;
  let pendingLines = input.lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    lotId: l.lotId ?? null,
    locationId: l.locationId ?? input.locationId ?? null,
  }));
  let holdId: string | null = null;

  if (reasonRequiresHold(input.reasonCode)) {
    const originQuarantine = origin.kind === "LAUNDRY" ? (await locationIdsOf(tx, origin.id)).get(QUARANTINE_LOCATION_CODE) ?? null : null;
    // En Lavandería la baja de blancos sale de su cuarentena (como antes del ajuste).
    if (originQuarantine) pendingLines = pendingLines.map((l) => ({ ...l, locationId: l.locationId ?? originQuarantine }));
    // Si todo viene ya de la cuarentena (p. ej. piezas rotas detectadas al recibir sucios) no hay retención.
    const alreadyQuarantined =
      originQuarantine !== null && pendingLines.length > 0 && pendingLines.every((l) => l.locationId === originQuarantine);

    if (!alreadyQuarantined) {
      const laundry =
        origin.kind === "LAUNDRY" ? origin : await warehouseOfKind(tx, "LAUNDRY", null, "HOTEL_WAREHOUSE_KIND_INVALID");
      const quarantine = await locationIdByCode(tx, laundry.id, QUARANTINE_LOCATION_CODE);
      const holdInput = {
        type: "TRANSFER" as const,
        fromWarehouseId: origin.id,
        warehouseId: laundry.id,
        sourceDocType: WRITEOFF_HOLD_DOC,
        notes: `Retención en cuarentena (baja en trámite, motivo ${input.reasonCode})`,
        lines: input.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          lotId: l.lotId ?? null,
          fromLocationId: l.locationId ?? input.locationId ?? undefined,
          toLocationId: quarantine,
        })),
      };
      assertMovementShape("TRANSFER", holdInput);
      const hold = await movements.applyInTransaction(tx, holdInput, input.actorId, null);
      holdId = hold.id;
      fromWarehouseId = laundry.id;
      fromLocationId = quarantine;
      pendingLines = hold.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        lotId: l.lotId,
        locationId: quarantine,
      }));
    }
  }

  const movementInput = {
    type: "WRITE_OFF" as const,
    fromWarehouseId,
    originWarehouseId: origin.id,
    reasonId: reason.id,
    notes: input.notes ?? null,
    forcePending: true,
    stocktakeId: input.stocktakeId ?? null,
    sourceDocType: WRITEOFF_DOC,
    sourceDocId: input.sourceDocId ?? null,
    lines: pendingLines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      lotId: l.lotId ?? null,
      fromLocationId: l.locationId ?? fromLocationId,
    })),
  };
  assertMovementShape("WRITE_OFF", movementInput);
  const created = await movements.applyInTransaction(tx, movementInput, input.actorId, null);
  if (holdId) await tx.hotelMovement.update({ where: { id: holdId }, data: { sourceDocId: created.id } });
  await tx.hotelSignature.create({
    data: { docType: WRITEOFF_DOC, docId: created.id, role: "DELIVERS", userId: input.actorId, method: "SESSION" },
  });
  return created;
};
