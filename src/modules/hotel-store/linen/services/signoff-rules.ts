import { HttpError } from "@core/middlewares/error.middleware";

/** Reglas puras de la 2ª firma en limpio a área (no bloquea stock). Sin base de datos. */

export const SIGNOFF_RESULTS = ["CONFORM", "DIFFERENCE"] as const;
export type SignoffResult = (typeof SIGNOFF_RESULTS)[number];

/** Almacenes de destino que son "área" (ropería, punto, spa). */
export const SIGNOFF_AREA_KINDS = ["ZONE", "POINT", "SPA"] as const;

/**
 * Aplica solo a un traspaso limpio de Lavandería a un área (incluye el surtido de pedidos, que es
 * TRANSFER). No aplica a sucio -> Lavandería ni a otros tipos (préstamos, primera lavada, amenidades).
 */
export const signoffApplies = (movement: { type: string; fromKind?: string | null; toKind?: string | null }): boolean =>
  movement.type === "TRANSFER" &&
  movement.fromKind === "LAUNDRY" &&
  (SIGNOFF_AREA_KINDS as readonly string[]).includes(movement.toKind ?? "");

/** Con diferencia la nota es obligatoria. */
export const assertSignoffNotes = (result: SignoffResult, notes: string | null | undefined): void => {
  if (result === "DIFFERENCE" && !(notes ?? "").trim()) throw new HttpError(422, "HOTEL_SIGNOFF_NOTES_REQUIRED");
};

/** Quién puede firmar: el traspaso debe estar por firmar y quien contó/recibió no firma. */
export const assertCanSignoff = (movement: { signoffStatus: string | null; receivedById: string | null }, actorId: string): void => {
  if (movement.signoffStatus === null) throw new HttpError(409, "HOTEL_SIGNOFF_NOT_APPLICABLE");
  if (movement.signoffStatus !== "PENDING") throw new HttpError(409, "HOTEL_SIGNOFF_ALREADY_DONE");
  if (movement.receivedById && movement.receivedById === actorId) throw new HttpError(409, "HOTEL_SIGNOFF_SAME_USER");
};
