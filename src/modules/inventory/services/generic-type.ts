import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Tipo de dispositivo al que caen las filas de la carga masiva por Excel cuyo
 * tipo no existe en el catálogo (o que no lo traen). Es el "cajón" editable: la
 * carga nunca inventa tipos, y la previsualización muestra exactamente qué filas
 * cayeron aquí para reclasificarlas después.
 *
 * Vive en su propio módulo porque lo necesitan tres lugares distintos y debe ser
 * EL MISMO en los tres: la carga masiva (que resuelve las filas), el seed (que lo
 * deja existir en una base recién cargada) y el arranque del API.
 */
export const GENERIC_DEVICE_TYPE = {
  code: "GENERICO",
  name: "GENÉRICO",
  assetTagPrefix: "GEN",
  useSerialNumber: false,
} as const;

/** Cliente o transacción: `ensureGenericDeviceType` sólo usa `deviceType`. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Clave de comparación de textos contra el catálogo: sin acentos, sin mayúsculas
 * y con espacios colapsados. "Teléfono " y "TELEFONO" son el mismo tipo, para que
 * una variación de captura no mande la fila al genérico.
 */
export const normalizeKey = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** ¿Este tipo del catálogo es el genérico? (por código o por nombre). */
export const isGenericType = (type: { code: string; name: string }): boolean =>
  normalizeKey(type.code) === normalizeKey(GENERIC_DEVICE_TYPE.code) ||
  normalizeKey(type.name) === normalizeKey(GENERIC_DEVICE_TYPE.name);

/**
 * Primer prefijo de activo libre para el genérico (`GEN`, `GEN2`, …): el prefijo
 * es único por tipo, así que no se puede asumir que `GEN` esté disponible.
 */
export const freeGenericPrefix = (types: { assetTagPrefix: string }[]): string => {
  const taken = new Set(types.map((type) => normalizeKey(type.assetTagPrefix)));
  let prefix: string = GENERIC_DEVICE_TYPE.assetTagPrefix;
  for (let i = 2; taken.has(normalizeKey(prefix)); i++) {
    prefix = `${GENERIC_DEVICE_TYPE.assetTagPrefix}${i}`;
  }
  return prefix;
};

/**
 * Garantiza que el tipo genérico exista. Insert-missing: si ya existe (por
 * código o por nombre, sin acentos ni mayúsculas) se respeta tal cual —incluidas
 * las ediciones que le hayan hecho— y sólo se crea cuando falta.
 *
 * Lo llaman el arranque del API (para que aparezca en el catálogo y se pueda
 * editar desde el primer día), la confirmación de la carga masiva (por si alguien
 * lo borró) y el seed (para que una base recién cargada ya lo tenga, sin esperar
 * al primer arranque).
 */
export const ensureGenericDeviceType = async (db: Db) => {
  const types = await db.deviceType.findMany();
  const existing = types.find(isGenericType);
  if (existing) return existing;

  return db.deviceType.create({
    data: { ...GENERIC_DEVICE_TYPE, assetTagPrefix: freeGenericPrefix(types) },
  });
};
