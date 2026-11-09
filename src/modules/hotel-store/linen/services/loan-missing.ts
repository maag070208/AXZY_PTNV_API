import type { Prisma } from "@prisma/client";
import type { HotelMovementService } from "../../services/movement.service";
import { createLinenWriteoffRequest } from "./writeoff-request";

export interface MissingReport {
  /** Almacén donde la pieza figura (punto o Recepción). */
  warehouseId: string;
  /** Ubicación de la que saldría la baja (LENT en préstamos; GENERAL en adicionales). */
  locationId: string;
  productId: string;
  quantity: number;
  /** Quién reporta (sesión). */
  actorId: string;
  /** Documento de origen (corte de turno, adicional) y su descripción para la baja. */
  sourceDocId: string;
  notes?: string | null;
  movements?: HotelMovementService;
}

/**
 * Registra un faltante de blancos como baja pendiente de autorización con motivo F (extravío),
 * dentro de la transacción de quien llama. Punto único de integración con las bajas de F3.
 */
export const reportMissing = async (tx: Prisma.TransactionClient, report: MissingReport): Promise<void> => {
  if (report.quantity <= 0) return;
  await createLinenWriteoffRequest(tx, {
    warehouseId: report.warehouseId,
    locationId: report.locationId,
    reasonCode: "F",
    lines: [{ productId: report.productId, quantity: report.quantity, locationId: report.locationId }],
    notes: report.notes ?? null,
    actorId: report.actorId,
    sourceDocId: report.sourceDocId,
    movements: report.movements,
  });
};
