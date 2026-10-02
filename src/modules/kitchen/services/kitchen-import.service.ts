import { Prisma, type PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";

type Tx = Prisma.TransactionClient;
/** Sirve igual un cliente normal (previsualización) que una transacción (confirmación). */
type Db = Tx | PrismaClient;

/**
 * CARGA MASIVA DEL INVENTARIO DE COCINA — "así está la bodega hoy".
 *
 * Una fila = un artículo con su existencia. La carga:
 *  1. crea el artículo si su código no existe,
 *  2. crea la categoría y la unidad de medida que falten en el catálogo (hoy la
 *     bodega arranca con 6 unidades y 0 categorías, así que sin esto ningún
 *     archivo real entraría),
 *  3. registra la existencia como ENTRADA: un lote por renglón, con su
 *     caducidad, lote y costo — es el único camino que respeta el kardex.
 *
 * Si el artículo YA existe, la fila se reporta y el usuario decide con
 * `strategy`:
 *  - `ADD` (sumar): registra una entrada nueva con la cantidad del archivo.
 *  - `SET` (poner esa): deja el artículo con la cantidad EXACTA del archivo,
 *    sumando la diferencia como entrada o ajustando a la baja por FEFO.
 *
 * Previsualización y confirmación comparten `plan()` (la misma resolución, con
 * el mismo lector de base), así que lo que el usuario revisó es lo que se
 * ejecuta; la confirmación vuelve a resolver DENTRO de su transacción, porque
 * entre revisar y confirmar la bodega pudo moverse.
 */

/** Estrategia cuando el artículo del archivo ya existe. */
export const KITCHEN_IMPORT_STRATEGIES = ["ADD", "SET"] as const;
export type KitchenImportStrategy = (typeof KITCHEN_IMPORT_STRATEGIES)[number];

/** Topes de la carga (mismos que la de dispositivos). */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_LINES = 500;
export const MAX_ROW_QUANTITY = 99_999_999;
export const MAX_ROW_COST = 99_999_999;
export const MAX_ROW_STOCK = 999_999_999;

/** Categoría para las filas que no traen una (se crea y se avisa). */
export const DEFAULT_CATEGORY = "SIN CATEGORÍA";
/** Unidad para las filas que no traen una: pieza (entera). */
export const DEFAULT_UNIT = { code: "PIECE", name: "Pieza", whole: true } as const;

/** Un renglón del Excel tal como lo lee el parser (columnas en español o inglés). */
export interface KitchenImportRawRow {
  /** Número de fila en Excel (2 = primer renglón de datos). */
  row: number;
  code: string;
  name: string;
  categoryName: string;
  unitName: string;
  quantity: string;
  expiresAt: string;
  lotCode: string;
  unitCost: string;
  minStock: string;
  maxStock: string;
  kind: string;
  storage: string;
  tracksExpiry: string;
  tax: string;
}

/** Qué va a pasar con la fila. */
export type KitchenImportAction = "CREATE" | "ADD" | "SET_UP" | "SET_DOWN" | "SET_SAME" | "NO_STOCK";

export interface KitchenImportPreviewRow {
  row: number;
  code: string;
  /** El archivo no traía código y se derivó del nombre. */
  codeDerived: boolean;
  name: string;
  categoryName: string;
  /** La categoría no está en el catálogo: se va a crear. */
  categoryNew: boolean;
  unitName: string;
  /** La unidad no está en el catálogo: se va a crear. */
  unitNew: boolean;
  kind: "CONSUMABLE" | "DURABLE";
  storage: "DRY" | "REFRIGERATED" | "FROZEN";
  tracksExpiry: boolean;
  minStock: number;
  maxStock: number | null;
  /** Tasa de IVA por defecto del artículo (del catálogo), si el archivo la trae. */
  taxRateId: string | null;
  taxRateName: string | null;
  quantity: number;
  unitCost: number | null;
  expiresAt: string | null;
  lotCode: string | null;
  action: KitchenImportAction;
  /** Cuánto se moverá el saldo (positivo entra, negativo sale). */
  delta: number;
  /** Existencia actual del artículo (solo si ya existía). */
  currentStock: number | null;
  /** Existencia con la que quedará. */
  resultingStock: number | null;
  warnings: string[];
  errors: string[];
}

export interface KitchenImportPreview {
  strategy: KitchenImportStrategy;
  rows: KitchenImportPreviewRow[];
  summary: {
    rows: number;
    valid: number;
    invalid: number;
    /** Artículos nuevos / que ya existían. */
    itemsToCreate: number;
    existingItems: number;
    /** Renglones que entran (lotes nuevos) y cantidad total que entra. */
    lots: number;
    quantityIn: number;
    /** Renglones que ajustan a la baja y cuánto sale. */
    adjustedOut: number;
    quantityOut: number;
    withoutStock: number;
    categoriesToCreate: string[];
    unitsToCreate: string[];
  };
}

export interface KitchenImportResult {
  /** `null` cuando la carga solo creó artículos (sin existencias que mover). */
  movementId: string | null;
  itemsCreated: number;
  itemsReused: number;
  categoriesCreated: number;
  unitsCreated: number;
  lotsCreated: number;
  quantityIn: number;
  quantityOut: number;
  rows: number;
  fileName: string | null;
  /** Mismo resultado en una petición repetida (idempotencia). */
  repeated: boolean;
}

const isBlank = (value: string): boolean => value.trim() === "";

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Convierte una fecha del archivo a `YYYY-MM-DD`.
 *
 * Excel entrega las fechas como número de serie (46296), pero también se acepta
 * el texto que la gente escribe (`02/10/2026`, `2026-10-02`). Un serial con hora
 * "casi medianoche" viene de una herramienta que escribió una fecha sin hora en
 * otra zona horaria: ahí se toma el día más cercano, para no guardar la
 * caducidad un día antes.
 */
export const parseImportDay = (value: string): string | null => {
  const raw = value.trim();
  if (isBlank(raw)) return null;

  const asNumber = Number(raw.replace(",", "."));
  if (Number.isFinite(asNumber) && asNumber > 20000 && asNumber < 80000) {
    const parsed = XLSX.SSF.parse_date_code(asNumber);
    if (!parsed) return null;
    const nearMidnight = parsed.T >= 86388 || parsed.T <= 12;
    const base = nearMidnight ? XLSX.SSF.parse_date_code(Math.round(asNumber)) : parsed;
    if (!base || base.y < 1990 || base.y > 2100) return null;
    return `${base.y}-${pad(base.m)}-${pad(base.d)}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${pad(Number(m))}-${pad(Number(d))}`;
  }

  // Día/mes/año, el orden en que se escribe en México.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${pad(Number(m))}-${pad(Number(d))}`;
  }

  // Último recurso: lo que el navegador sí sabe interpretar (con letras o
  // separadores; un número suelto no es una fecha).
  if (/[a-zA-Z]/.test(raw) || raw.includes(" ")) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 1990 && date.getFullYear() <= 2100) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
  }
  return null;
};

/** Número con hasta 3 decimales (acepta "1,5"). `null` si no es un número válido. */
export const parseImportNumber = (value: string): number | null => {
  const raw = value.trim();
  if (isBlank(raw)) return null;
  const cleaned = raw.replace(/\s/g, "").replace(/\$|MXN|mxn/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return Number.NaN;
  return n;
};

const parseKind = (value: string): "CONSUMABLE" | "DURABLE" | null => {
  const key = value.trim().toUpperCase();
  if (isBlank(key)) return "CONSUMABLE";
  if (/CONSUM|INSUMO|ALIMENT|COMIDA|BEBIDA|ABARROTE/.test(key)) return "CONSUMABLE";
  if (/DURAD|UTENSIL|VAJILLA|EQUIPO|HERRAMIENT|MENAJE|CRISTALER/.test(key)) return "DURABLE";
  return null;
};

const parseStorage = (value: string): "DRY" | "REFRIGERATED" | "FROZEN" | null => {
  const key = value.trim().toUpperCase();
  if (isBlank(key)) return "DRY";
  if (/SECO|AMBIENTE|BODEGA|ALMACEN|DRY|NO PERECEDERO/.test(key)) return "DRY";
  if (/REFRIG|FRIO|FRÍA|FRIA|REFRIGERATED|COOL/.test(key)) return "REFRIGERATED";
  if (/CONGELA|FREEZER|FROZEN/.test(key)) return "FROZEN";
  return null;
};

/** SÍ/NO del archivo; `null` si viene vacío o no se entiende. */
const parseBoolean = (value: string): boolean | null => {
  const key = value.trim().toUpperCase();
  if (isBlank(key)) return null;
  if (/^(SI|SÍ|S|YES|Y|TRUE|VERDADERO|1|X)$/.test(key)) return true;
  if (/^(NO|N|FALSE|FALSO|0)$/.test(key)) return false;
  return null;
};

/**
 * Código de artículo a partir del nombre: mayúsculas, sin acentos, solo letras,
 * números y guiones (el modelo lo pide único y de 30 caracteres).
 */
export const codeFromName = (name: string): string => {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "ARTICULO").slice(0, 30);
};

/** Lee la primera hoja y mapea sus columnas al formato de carga. */
export const parseKitchenImportRows = (buffer: Buffer): KitchenImportRawRow[] => {
  const raw = parseFirstSheet(buffer);
  const rows: KitchenImportRawRow[] = [];

  raw.forEach((item, index) => {
    const row: KitchenImportRawRow = {
      row: index + 2,
      code: pickColumn(item, ["CÓDIGO", "CODIGO", "CLAVE", "SKU", "CODE"]),
      name: pickColumn(item, [
        "ARTÍCULO",
        "ARTICULO",
        "NOMBRE",
        "NOMBRE DEL ARTÍCULO",
        "DESCRIPCIÓN",
        "DESCRIPCION",
        "INSUMO",
        "PRODUCTO",
        "NAME",
        "ITEM",
        "DESCRIPTION",
      ]),
      categoryName: pickColumn(item, ["CATEGORÍA", "CATEGORIA", "GRUPO", "FAMILIA", "LÍNEA", "LINEA", "CATEGORY", "GROUP"]),
      unitName: pickColumn(item, ["UNIDAD", "UNIDAD DE MEDIDA", "U.M.", "UM", "MEDIDA", "UNIT", "UOM"]),
      quantity: pickColumn(item, ["CANTIDAD", "CANT.", "CANT", "EXISTENCIA", "QTY", "QUANTITY"]),
      expiresAt: pickColumn(item, ["CADUCIDAD", "FECHA DE CADUCIDAD", "VENCIMIENTO", "CADUCA", "EXPIRA", "EXPIRY", "EXPIRES"]),
      lotCode: pickColumn(item, ["LOTE", "NO. DE LOTE", "NO LOTE", "NUMERO DE LOTE", "LOT"]),
      unitCost: pickColumn(item, ["COSTO", "COSTO UNITARIO", "PRECIO", "PRECIO UNITARIO", "COST", "UNIT COST", "PRICE"]),
      minStock: pickColumn(item, ["MÍNIMO", "MINIMO", "MIN", "STOCK MÍNIMO", "STOCK MINIMO", "MIN STOCK"]),
      maxStock: pickColumn(item, ["MÁXIMO", "MAXIMO", "MAX", "STOCK MÁXIMO", "STOCK MAXIMO", "MAX STOCK"]),
      kind: pickColumn(item, ["TIPO", "TIPO DE ARTÍCULO", "CLASE", "KIND", "TYPE"]),
      storage: pickColumn(item, ["ALMACÉN", "ALMACEN", "UBICACIÓN", "UBICACION", "RESGUARDO", "STORAGE"]),
      tracksExpiry: pickColumn(item, ["PERECEDERO", "CADUCA", "EXPIRA", "PERISHABLE", "TRACKS EXPIRY"]),
      tax: pickColumn(item, ["IVA", "TASA", "IMPUESTO", "TAX", "VAT"]),
    };

    const empty =
      isBlank(row.code) &&
      isBlank(row.name) &&
      isBlank(row.categoryName) &&
      isBlank(row.unitName) &&
      isBlank(row.quantity) &&
      isBlank(row.expiresAt) &&
      isBlank(row.lotCode) &&
      isBlank(row.unitCost);
    if (!empty) rows.push(row);
  });

  return rows;
};

/** Encabezados de la plantilla, en el orden en que se capturan. */
export const KITCHEN_IMPORT_COLUMNS = [
  "CÓDIGO",
  "ARTÍCULO",
  "CATEGORÍA",
  "UNIDAD",
  "CANTIDAD",
  "CADUCIDAD",
  "LOTE",
  "COSTO",
  "MÍNIMO",
  "MÁXIMO",
  "TIPO",
  "ALMACÉN",
  "PERECEDERO",
  "IVA",
] as const;

/**
 * Plantilla de la carga: la hoja "Artículos" trae los encabezados, dos
 * renglones de ejemplo y uno que solo crea el artículo (sin existencia); la
 * hoja "Catálogos" lo que ya existe (categorías, unidades, tipos, almacenes y
 * tasas de IVA) para escribirlo tal cual — lo que no coincida se crea, salvo el
 * tipo/almacén/IVA, que se avisan como error.
 */
export const buildKitchenImportTemplate = (catalog: {
  categories: string[];
  units: { code: string; name: string }[];
  taxRates: { name: string; rate: number }[];
}): Buffer => {
  const workbook = XLSX.utils.book_new();

  const items = XLSX.utils.aoa_to_sheet([
    [...KITCHEN_IMPORT_COLUMNS],
    ["LECHE-ENTERA-1L", "LECHE ENTERA 1 L", "LÁCTEOS", "LITRO", 24, "2026-10-20", "", 22.5, 10, 40, "CONSUMIBLE", "REFRIGERADO", "SÍ", "16"],
    ["POLLO-PECHUGA-KG", "PECHUGA DE POLLO", "CARNES", "KILOGRAMO", 15.5, "2026-10-05", "L-20261001-001", 98, 5, 30, "CONSUMIBLE", "CONGELADO", "SÍ", "0"],
    ["PLATO-LLANO", "PLATO LLANO", "VAJILLA", "PIEZA", 120, "", "", 45, 24, 200, "DURADERO", "SECO", "NO", "16"],
    ["SAL-FINA-KG", "SAL FINA", "ABARROTES", "KILOGRAMO", "", "", "", 18, 5, 25, "CONSUMIBLE", "SECO", "NO", "16"],
  ]);
  items["!cols"] = [
    { wch: 20 },
    { wch: 30 },
    { wch: 16 },
    { wch: 14 },
    { wch: 11 },
    { wch: 13 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 13 },
    { wch: 15 },
    { wch: 12 },
    { wch: 7 },
  ];
  XLSX.utils.book_append_sheet(workbook, items, "Artículos");

  const catalogs = XLSX.utils.aoa_to_sheet([
    ["CATEGORÍAS", "", "UNIDADES", "", "", "TIPO", "ALMACÉN", "PERECEDERO", "IVA"],
    ...Array.from({ length: Math.max(catalog.categories.length, catalog.units.length, 1) }).map((_, i) => [
      catalog.categories[i] ?? "",
      "",
      catalog.units[i]?.name ?? "",
      catalog.units[i]?.code ?? "",
      "",
      i === 0 ? "CONSUMIBLE" : i === 1 ? "DURADERO" : "",
      i === 0 ? "SECO" : i === 1 ? "REFRIGERADO" : i === 2 ? "CONGELADO" : "",
      i === 0 ? "SÍ" : i === 1 ? "NO" : "",
      catalog.taxRates[i] ? `${catalog.taxRates[i].name} (${catalog.taxRates[i].rate * 100}%)` : "",
    ]),
    ["(las que falten se crean solas)", "", "(las que falten se crean solas)"],
  ]);
  catalogs["!cols"] = [{ wch: 26 }, { wch: 4 }, { wch: 20 }, { wch: 12 }, { wch: 4 }, { wch: 14 }, { wch: 15 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, catalogs, "Catálogos");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/**
 * Carga masiva del inventario de cocina: parser, plantilla y resolución.
 *
 * Este servicio NO escribe: la previsualización resuelve contra la base y la
 * confirmación vive en `KitchenStockService` (es quien tiene las transacciones y
 * los helpers de lote/movimiento), pero usa `plan()` de aquí para no tener dos
 * versiones de la misma decisión.
 */
export class KitchenImportService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  /** Lo que la carga haría con el archivo, sin tocar la base. */
  async preview(raw: KitchenImportRawRow[], strategy: KitchenImportStrategy): Promise<KitchenImportPreview> {
    return this.plan(this.db, raw, strategy);
  }

  /** Catálogos actuales, para la plantilla. */
  async templateCatalog() {
    const [categories, units, taxRates] = await Promise.all([
      this.db.kitchenCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.db.kitchenUnit.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.db.taxRate.findMany({ where: { active: true }, orderBy: { rate: "asc" } }),
    ]);
    return {
      categories: categories.map((c) => c.name),
      units: units.map((u) => ({ code: u.code, name: u.name })),
      taxRates: taxRates.map((r) => ({ name: r.name, rate: Number(r.rate) })),
    };
  }

  /**
   * Resolución ÚNICA de las filas (la comparten previsualización y confirmación).
   * `db` puede ser el cliente o la transacción de la confirmación.
   */
  async plan(db: Db, raw: KitchenImportRawRow[], strategy: KitchenImportStrategy): Promise<KitchenImportPreview> {
    if (raw.length > MAX_IMPORT_ROWS) {
      throw new HttpError(400, "KITCHEN_IMPORT_TOO_MANY_ROWS", { max: MAX_IMPORT_ROWS });
    }

    const [categories, units, taxRates] = await Promise.all([
      db.kitchenCategory.findMany(),
      db.kitchenUnit.findMany(),
      db.taxRate.findMany(),
    ]);
    const categoryByKey = new Map(categories.map((c) => [this.key(c.name), c]));
    const unitByKey = new Map<string, (typeof units)[number]>();
    for (const unit of units) {
      unitByKey.set(this.key(unit.name), unit);
      unitByKey.set(this.key(unit.code), unit);
    }

    // Códigos del archivo: la resolución se hace de una sola pasada, así que los
    // artículos que la MISMA carga va a crear cuentan como existentes para los
    // renglones siguientes (dos lotes del mismo artículo en un archivo).
    const rows: KitchenImportPreviewRow[] = [];
    const codeOfRow = raw.map((item) => (isBlank(item.code) ? codeFromName(item.name) : item.code.trim().toUpperCase().slice(0, 30)));
    const existingByCode = new Map(
      (await db.kitchenItem.findMany({ where: { code: { in: [...new Set(codeOfRow)] } } })).map((item) => [item.code, item])
    );

    const currentStock = new Map<string, number>();
    const itemIds = [...existingByCode.values()].map((item) => item.id);
    if (itemIds.length > 0) {
      const grouped = await db.kitchenLot.groupBy({
        by: ["itemId"],
        where: { itemId: { in: itemIds }, onHand: { gt: 0 } },
        _sum: { onHand: true },
      });
      for (const entry of grouped) currentStock.set(entry.itemId, Number(entry._sum.onHand ?? 0));
    }

    // Lotes que ya existen: un código de lote repetido en el mismo artículo es
    // choque seguro (el modelo lo exige único por artículo).
    const takenLots = new Set<string>();
    if (itemIds.length > 0) {
      const lots = await db.kitchenLot.findMany({
        where: { itemId: { in: itemIds } },
        select: { itemId: true, lotCode: true },
      });
      for (const lot of lots) takenLots.add(`${lot.itemId}:${lot.lotCode}`);
    }

    const pendingCategories = new Set<string>();
    const pendingUnits = new Set<string>();
    const pendingCodes = new Set<string>();
    const seenSetByCode = new Set<string>();
    let quantityIn = 0;
    let quantityOut = 0;
    let lots = 0;
    let adjustedOut = 0;
    let withoutStock = 0;
    let itemsToCreate = 0;
    let existingItems = 0;

    for (let index = 0; index < raw.length; index++) {
      const item = raw[index];
      const errors: string[] = [];
      const warnings: string[] = [];

      const name = item.name.trim();
      if (!name) errors.push("MISSING_NAME");
      if (name.length > 120) errors.push("NAME_TOO_LONG");

      const code = codeOfRow[index];
      const codeDerived = isBlank(item.code);
      if (codeDerived) warnings.push("CODE_DERIVED");
      if (code.length > 30) errors.push("CODE_TOO_LONG");

      const categoryNameRaw = item.categoryName.trim();
      const categoryName = categoryNameRaw || DEFAULT_CATEGORY;
      if (!categoryNameRaw) warnings.push("CATEGORY_DEFAULT");
      if (categoryName.length > 60) errors.push("CATEGORY_TOO_LONG");
      const categoryNew = !categoryByKey.has(this.key(categoryName));

      const unitNameRaw = item.unitName.trim();
      const unitName = unitNameRaw || DEFAULT_UNIT.name;
      if (!unitNameRaw) warnings.push("UNIT_DEFAULT");
      if (unitName.length > 60) errors.push("UNIT_TOO_LONG");
      const unitNew = !unitByKey.has(this.key(unitName));

      const kind = parseKind(item.kind);
      if (!kind) errors.push("INVALID_KIND");
      const storage = parseStorage(item.storage);
      if (!storage) errors.push("INVALID_STORAGE");
      // Perecedero: manda la columna; si no viene, manda la caducidad — un
      // archivo de bodega completa no puede exigir fecha a los platos y
      // utensilios, pero una caducidad capturada siempre se respeta.
      const perishableCell = item.tracksExpiry.trim();
      let tracksExpiry: boolean;
      if (isBlank(perishableCell)) {
        tracksExpiry = !isBlank(item.expiresAt);
        if (!tracksExpiry) warnings.push("PERISHABLE_ASSUMED_NO");
      } else {
        const parsed = parseBoolean(perishableCell);
        if (parsed === null) errors.push("INVALID_PERISHABLE");
        tracksExpiry = parsed ?? true;
      }

      const quantityRaw = parseImportNumber(item.quantity);
      if (Number.isNaN(quantityRaw)) errors.push("INVALID_QUANTITY");
      const quantity = quantityRaw ?? 0;
      if (!Number.isNaN(quantityRaw) && quantityRaw !== null && (quantityRaw < 0 || quantityRaw > MAX_ROW_QUANTITY)) {
        errors.push("QUANTITY_TOO_LARGE");
      }
      if (quantityRaw !== null && !Number.isNaN(quantityRaw) && Math.abs(quantityRaw * 1000 - Math.round(quantityRaw * 1000)) > 1e-6) {
        errors.push("QUANTITY_DECIMALS");
      }

      const minRaw = parseImportNumber(item.minStock);
      if (Number.isNaN(minRaw)) errors.push("INVALID_MIN");
      const minStock = minRaw ?? 0;
      if (minStock < 0 || minStock > MAX_ROW_STOCK) errors.push("INVALID_MIN");
      const maxRaw = parseImportNumber(item.maxStock);
      if (Number.isNaN(maxRaw)) errors.push("INVALID_MAX");
      const maxStock = maxRaw ?? null;
      if (maxStock !== null && (maxStock < 0 || maxStock > MAX_ROW_STOCK)) errors.push("INVALID_MAX");
      if (maxStock !== null && maxStock < minStock) errors.push("MIN_GREATER_THAN_MAX");

      const costRaw = parseImportNumber(item.unitCost);
      if (Number.isNaN(costRaw)) errors.push("INVALID_COST");
      const unitCost = costRaw ?? null;
      if (unitCost !== null && (unitCost < 0 || unitCost > MAX_ROW_COST)) errors.push("INVALID_COST");

      const expiresAt = parseImportDay(item.expiresAt);
      if (!isBlank(item.expiresAt) && !expiresAt) errors.push("INVALID_EXPIRY");
      if (tracksExpiry && quantity > 0 && !expiresAt) errors.push("EXPIRY_REQUIRED");

      const lotCode = isBlank(item.lotCode) ? null : item.lotCode.trim().toUpperCase().slice(0, 40);

      // IVA: se compara contra el catálogo por tasa (acepta "16", "16%" o 0.16).
      let taxRateId: string | null = null;
      let taxRateName: string | null = null;
      if (!isBlank(item.tax)) {
        const parsedTax = parseImportNumber(item.tax.replace("%", ""));
        const rate = Number.isNaN(parsedTax) || parsedTax === null ? null : parsedTax > 1 ? parsedTax / 100 : parsedTax;
        const match = rate === null ? undefined : taxRates.find((t) => Math.abs(Number(t.rate) - rate) < 1e-6);
        if (!match) errors.push("INVALID_TAX");
        else {
          taxRateId = match.id;
          taxRateName = match.name;
        }
      }

      const existing = existingByCode.get(code) ?? null;
      const isNew = !existing && !pendingCodes.has(code);
      if (isNew) pendingCodes.add(code);
      if (isNew) itemsToCreate += 1;
      else existingItems += 1;

      if (existing && strategy === "SET") {
        const key = `${code}`;
        if (seenSetByCode.has(key)) errors.push("DUPLICATE_CODE_SET");
        seenSetByCode.add(key);
      }

      // Acción: alta, suma, o dejar el saldo exacto que dice el archivo.
      const current = existing ? (currentStock.get(existing.id) ?? 0) : 0;
      let action: KitchenImportAction;
      let delta = 0;
      if (quantity <= 0) {
        action = isNew ? "CREATE" : "NO_STOCK";
        withoutStock += 1;
      } else if (isNew) {
        action = "CREATE";
        delta = quantity;
      } else if (strategy === "ADD") {
        action = "ADD";
        delta = quantity;
      } else if (quantity > current) {
        action = "SET_UP";
        delta = quantity - current;
      } else if (quantity < current) {
        action = "SET_DOWN";
        delta = quantity - current;
      } else {
        action = "SET_SAME";
        delta = 0;
      }

      if (existing && strategy === "ADD") warnings.push("STOCK_ADDED");
      if (existing && strategy === "SET" && action === "SET_DOWN") warnings.push("STOCK_REDUCED");
      if (existing && strategy === "SET" && action === "SET_SAME") warnings.push("STOCK_UNCHANGED");

      if (delta > 0) {
        lots += 1;
        quantityIn += delta;
        if (existing && lotCode && takenLots.has(`${existing.id}:${lotCode}`)) errors.push("LOT_CODE_TAKEN");
      }
      if (delta < 0) {
        adjustedOut += 1;
        quantityOut += Math.abs(delta);
      }
      if (existing && strategy === "SET" && delta < 0 && current + delta < 0) errors.push("INSUFFICIENT_STOCK");

      if (errors.length === 0) {
        if (categoryNew) pendingCategories.add(categoryName);
        if (unitNew) pendingUnits.add(unitName);
      }

      rows.push({
        row: item.row,
        code,
        codeDerived,
        name,
        categoryName,
        categoryNew,
        unitName,
        unitNew,
        kind: kind ?? "CONSUMABLE",
        storage: storage ?? "DRY",
        tracksExpiry: tracksExpiry ?? true,
        minStock,
        maxStock,
        taxRateId,
        taxRateName,
        quantity,
        unitCost,
        expiresAt,
        lotCode,
        action,
        delta,
        currentStock: existing ? current : null,
        resultingStock: existing || quantity > 0 ? (isNew ? quantity : current + delta) : null,
        warnings,
        errors,
      });
    }

    const invalid = rows.filter((row) => row.errors.length > 0).length;
    if (lots > MAX_IMPORT_LINES) {
      throw new HttpError(400, "KITCHEN_IMPORT_TOO_MANY_LINES", { max: MAX_IMPORT_LINES });
    }

    return {
      strategy,
      rows,
      summary: {
        rows: rows.length,
        valid: rows.length - invalid,
        invalid,
        itemsToCreate,
        existingItems,
        lots,
        quantityIn,
        adjustedOut,
        quantityOut,
        withoutStock,
        categoriesToCreate: [...pendingCategories],
        unitsToCreate: [...pendingUnits],
      },
    };
  }

  /** Clave de comparación de nombres: sin acentos, mayúsculas ni espacios extra. */
  key(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
  }
}
