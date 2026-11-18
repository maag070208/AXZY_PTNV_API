import { HttpError } from "@core/middlewares/error.middleware";
import { expectedForRoom, type RoomComposition, type RoomParLine } from "./room-par-rules";

/** Reglas puras de la entrega de amenidades (Almacén -> ropería con destinataria supervisora). */

/** Almacenes que pueden entregar amenidades (el almacén central, p. ej. AME). */
export const AMENITY_SOURCE_KINDS = ["CENTRAL"] as const;

export const FOLIO_PREFIX = "EA-";
export const amenityFolio = (count: number): string => `${FOLIO_PREFIX}${String(count + 1).padStart(4, "0")}`;

/** El origen debe ser el almacén (central) y el destino una ropería de zona. */
export const assertAmenityRoute = (fromKind: string, toKind: string): void => {
  if (!(AMENITY_SOURCE_KINDS as readonly string[]).includes(fromKind)) throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_SOURCE_INVALID");
  if (toKind !== "ZONE") throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_TARGET_INVALID");
};

/** La destinataria debe tener el rol de supervisora de piso y estar asignada a la zona (o a un ancestro). */
export const assertRecipientValid = (recipient: { hasSupervisorRole: boolean; supervisesZone: boolean }): void => {
  if (!recipient.hasSupervisorRole || !recipient.supervisesZone) throw new HttpError(422, "HOTEL_AMENITY_DELIVERY_RECIPIENT_INVALID");
};

export interface AmenitySuggestionLine {
  productId: string;
  expected: number;
  onHand: number;
  suggested: number;
}

/**
 * Sugerido por área = Σ por habitación del esperado de la dotación (solo amenidades consumibles) menos
 * la existencia del área; nunca negativo. Los artículos sin faltante se omiten.
 */
export const amenitySuggestion = (
  rooms: RoomComposition[],
  pars: RoomParLine[],
  consumableIds: ReadonlySet<string>,
  onHand: ReadonlyMap<string, number>
): AmenitySuggestionLine[] => {
  const consumablePars = pars.filter((p) => consumableIds.has(p.productId));
  const expected = new Map<string, number>();
  for (const room of rooms) {
    for (const [productId, qty] of expectedForRoom(room, consumablePars)) expected.set(productId, (expected.get(productId) ?? 0) + qty);
  }
  return [...expected.entries()]
    .map(([productId, exp]) => {
      const have = onHand.get(productId) ?? 0;
      return { productId, expected: exp, onHand: have, suggested: Math.max(0, exp - have) };
    })
    .filter((l) => l.suggested > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId));
};
