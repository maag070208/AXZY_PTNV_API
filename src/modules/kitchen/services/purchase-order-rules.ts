/**
 * Reglas puras de la orden de compra: armado de destinatarios del correo y
 * formato del folio con año.
 */

/** Formato de correo suficiente para validar destinatarios capturados a mano. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Correos válidos que vienen separados por coma; descarta vacíos. `null` = hay uno inválido. */
export const parseEmailRecipients = (raw: string): string[] | null => {
  const recipients = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (recipients.length === 0) return null;
  return recipients.every((value) => EMAIL_PATTERN.test(value)) ? recipients : null;
};

/** Folio de la orden de compra con año: `OC-2026-0001`. */
export const formatPurchaseOrderNumber = (year: number, sequence: number): string =>
  `OC-${year}-${String(sequence).padStart(4, "0")}`;
