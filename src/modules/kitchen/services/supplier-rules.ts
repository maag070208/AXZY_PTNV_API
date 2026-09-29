/**
 * Reglas puras de proveedores: RFC y conversión de la unidad de compra
 * (caja, bulto) a la unidad base del artículo.
 */

/** Formato SAT: 3 letras (moral) o 4 (física) + fecha AAMMDD + homoclave de 3. */
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** RFC en mayúsculas y sin espacios; vacío = null. */
export const normalizeRfc = (rfc: string | null | undefined): string | null => {
  if (rfc == null) return null;
  const clean = rfc.replace(/\s+/g, "").toUpperCase();
  return clean === "" ? null : clean;
};

/** RFC con formato válido y fecha real (mes 01–12, día 01–31). */
export const isValidRfc = (rfc: string): boolean => {
  if (!RFC_PATTERN.test(rfc)) return false;
  const date = rfc.slice(rfc.length - 9, rfc.length - 3);
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/**
 * Cantidad y costo capturados en unidad de compra → unidad base.
 * 3 cajas de 12 a $120 la caja = 36 piezas a $10.
 */
export const toBaseUnits = (quantity: number, unitCost: number | null | undefined, factor: number) => ({
  quantity: round(quantity * factor, 3),
  unitCost: unitCost == null ? null : round(unitCost / factor, 4),
});

/** Contactos: a lo más uno principal; si hay y ninguno lo es, el primero. `null` = más de uno. */
export const withPrimary = <T extends { isPrimary?: boolean }>(contacts: T[]): Array<T & { isPrimary: boolean }> | null => {
  const primaries = contacts.filter((c) => c.isPrimary).length;
  if (primaries > 1) return null;
  return contacts.map((c, i) => ({ ...c, isPrimary: primaries === 0 ? i === 0 : Boolean(c.isPrimary) }));
};
