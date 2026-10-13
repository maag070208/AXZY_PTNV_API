import { Prisma, type PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { label, systemLanguage, t } from "@core/i18n";
import { broadcastDashboardEvent } from "@core/services/ably";
import { parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
import type { AuditPort } from "../../audit/models/entity/audit.entity";
import { createUnits, formatAssetTag } from "./device-units";
import { generateUniqueDeviceCode, normalizeDeviceCode } from "./device-code";
import {
  GENERIC_DEVICE_TYPE,
  ensureGenericDeviceType,
  freeGenericPrefix,
  isGenericType,
  normalizeKey,
} from "./generic-type";
import { serializable } from "./transaction";

// La definición del tipo genérico vive en `./generic-type` (la comparten la
// carga, el seed y el arranque del API); se reexporta para no cambiar la API
// pública de este servicio.
export { GENERIC_DEVICE_TYPE, normalizeKey };

type Tx = Prisma.TransactionClient;

/** Tope de filas por archivo y de unidades por carga. */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_UNITS = 5000;
export const MAX_ROW_QUANTITY = 5000;

/** Valores por defecto cuando el Excel no trae marca/modelo (se avisan). */
export const MISSING_BRAND = "SIN MARCA";
export const MISSING_MODEL = "SIN MODELO";

/** Un renglón del Excel tal como lo lee el parser (columnas en español o inglés). */
export interface DeviceImportRawRow {
  /** Número de fila en Excel (2 = primer renglón de datos). */
  row: number;
  /** Código de barras o interno del modelo; vacío = lo genera el sistema al crearlo. */
  code: string;
  typeName: string;
  name: string;
  brand: string;
  model: string;
  quantity: string;
}

export type DeviceImportAction = "CREATE" | "ADD_UNITS";

/** Tipo elegido por el usuario por número de fila de Excel (gana sobre el del archivo). */
export type TypeOverrides = Map<number, string>;

/** Un renglón ya resuelto contra la base: lo que la carga va a hacer con él. */
export interface DeviceImportPreviewRow {
  row: number;
  typeName: string;
  /** Nombre del tipo en el catálogo (o el genérico) al que quedó asignada la fila. */
  resolvedTypeName: string;
  resolvedTypeCode: string;
  /** La fila trae un tipo que no está en el catálogo → se fue al genérico. */
  typeUnknown: boolean;
  /** La fila no trae tipo (columna vacía) → se fue al genérico. */
  typeMissing: boolean;
  /** El usuario eligió el tipo de esta fila en la previsualización (gana sobre el archivo). */
  typeOverridden: boolean;
  /** Código del modelo: el del catálogo si ya existe; el del archivo si es alta; null = se genera al crear. */
  code: string | null;
  /** Dispositivo existente al que se suman las unidades (null = alta). */
  deviceId: string | null;
  /** Tipo al que queda el dispositivo; null = el genérico, que la confirmación crea si falta. */
  typeId: string | null;
  name: string;
  brand: string;
  model: string;
  quantity: number;
  action: DeviceImportAction;
  /** Filas del mismo archivo que caen en este mismo dispositivo. */
  mergedRows: number[];
  /** Unidades que ya tiene el dispositivo (solo en ADD_UNITS). */
  currentUnits: number;
  assetTagFrom: string | null;
  assetTagTo: string | null;
  warnings: string[];
  errors: string[];
}

export interface DeviceImportPreview {
  rows: DeviceImportPreviewRow[];
  /** Ya se cargó antes un archivo con exactamente este contenido (null = no). */
  repeatedImport: RepeatedImport | null;
  summary: {
    rows: number;
    valid: number;
    invalid: number;
    units: number;
    newDevices: number;
    existingDevices: number;
    genericRows: number;
    unknownTypeRows: number;
    /** Tipos que la carga tendría que crear; hoy solo el genérico si falta. */
    typesToCreate: string[];
  };
}

/** Resolución de la carga sin el aviso de archivo repetido (ese se consulta aparte). */
type DevicePlan = Omit<DeviceImportPreview, "repeatedImport">;

export interface RepeatedImport {
  movementId: string;
  importedAt: string;
  fileName: string | null;
}

export interface DeviceImportResult {
  movementId: string;
  devicesCreated: number;
  devicesReused: number;
  unitsCreated: number;
  rows: number;
  fileName: string | null;
  /** Mismo resultado en una petición repetida (idempotencia). */
  repeated: boolean;
}

const isBlank = (value: string): boolean => value.trim() === "";

/**
 * Lee la primera hoja del Excel y mapea sus columnas a las del formato de carga.
 * Acepta encabezados en español o inglés, con o sin acentos (`normalizeHeader`
 * los compara sin distinguir mayúsculas ni espacios), y conserva el número de
 * fila de Excel para poder señalar los renglones con problemas.
 *
 * Se ignoran los renglones totalmente vacíos (los archivos suelen traerlos al
 * final) y también los que solo traen formato.
 */
export const parseDeviceImportRows = (buffer: Buffer): DeviceImportRawRow[] => {
  const raw = parseFirstSheet(buffer);
  const rows: DeviceImportRawRow[] = [];

  raw.forEach((item, index) => {
    const row: DeviceImportRawRow = {
      row: index + 2, // +1 por el encabezado, +1 porque Excel empieza en 1
      code: pickColumn(item, ["CODIGO", "CODIGO DE BARRAS", "CODE", "BARCODE", "SKU"]),
      typeName: pickColumn(item, ["TIPO", "TIPO DE DISPOSITIVO", "TYPE", "DEVICE TYPE"]),
      name: pickColumn(item, [
        "NOMBRE",
        "DISPOSITIVO",
        "DESCRIPCIÓN",
        "DESCRIPCION",
        "NOMBRE DEL DISPOSITIVO",
        "NAME",
        "DEVICE",
        "DESCRIPTION",
      ]),
      brand: pickColumn(item, ["MARCA", "BRAND"]),
      model: pickColumn(item, ["MODELO", "MODEL"]),
      quantity: pickColumn(item, ["CANTIDAD", "CANT.", "CANT", "QTY", "QUANTITY"]),
    };

    const empty =
      isBlank(row.code) &&
      isBlank(row.typeName) &&
      isBlank(row.name) &&
      isBlank(row.brand) &&
      isBlank(row.model) &&
      isBlank(row.quantity);
    if (!empty) rows.push(row);
  });

  return rows;
};

/** Encabezados de la plantilla, en el orden en que se capturan. */
export const DEVICE_IMPORT_COLUMNS = [
  "CÓDIGO",
  "TIPO",
  "NOMBRE",
  "MARCA",
  "MODELO",
  "CANTIDAD",
] as const;

/**
 * Plantilla Excel de la carga masiva: la hoja "Dispositivos" trae los
 * encabezados y renglones de ejemplo, y la hoja "Tipos" el catálogo actual para
 * que el tipo se escriba tal cual (si no coincide, la fila cae al genérico).
 */
export const buildDeviceImportTemplate = (
  types: { code: string; name: string; active: boolean }[]
): Buffer => {
  const workbook = XLSX.utils.book_new();

  const devices = XLSX.utils.aoa_to_sheet([
    [...DEVICE_IMPORT_COLUMNS],
    ["", "MOUSE ALAMBRICO", "MOUSE OPTICO USB", "LOGITECH", "M90", 10],
    ["", "MONITOR", "MONITOR 24\"", "DELL", "P2419H", 5],
    ["", "", "CABLE HDMI 2M", "GENERICO", "HDMI-2M", 25],
  ]);
  devices["!cols"] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 34 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, devices, "Dispositivos");

  const catalog = XLSX.utils.aoa_to_sheet([
    ["CÓDIGO", "TIPO", "ACTIVO"],
    ...types.map((type) => [type.code, type.name, type.active ? "SÍ" : "NO"]),
  ]);
  catalog["!cols"] = [{ wch: 18 }, { wch: 40 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, catalog, "Tipos");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/** Grupo de filas que termina en un mismo dispositivo (la clave del alta). */
interface DeviceGroup {
  typeId: string;
  deviceId: string | null;
  code: string | null;
  name: string;
  brand: string;
  model: string;
  quantity: number;
}

/** Un dispositivo del catálogo tal como lo necesita la resolución de filas. */
interface DeviceRef {
  id: string;
  typeId: string;
  code: string | null;
  name: string;
  brand: string;
  model: string;
  currentUnits: number;
}

interface DeviceIndex {
  byCode: Map<string, DeviceRef>;
  byKey: Map<string, DeviceRef>;
  /** Marca + modelo normalizados: un mismo modelo puede tener varios nombres en el catálogo. */
  byModel: Map<string, DeviceRef[]>;
}

/** Cómo quedó ligada una fila a un dispositivo existente. */
type DeviceMatch = "CODE" | "NAME" | "MODEL" | null;

const modelKeyOf = (brand: string, model: string): string =>
  `${normalizeKey(brand)}|${normalizeKey(model)}`;

/**
 * Carga masiva de dispositivos desde Excel.
 *
 * Dos pasos, ambos con el MISMO parseo y la MISMA resolución de tipo (por eso
 * el controlador vuelve a recibir el archivo en la confirmación, en vez de
 * confiar en lo que el navegador manda de vuelta): la previsualización no
 * escribe nada y muestra exactamente qué va a pasar —altas, unidades que se
 * suman a dispositivos existentes, filas que caen al tipo genérico y folios de
 * activo fijo que se van a consumir—; la confirmación crea todo en UNA
 * transacción Serializable. Si algo falla no se crea nada: no puede quedar una
 * carga a medias que descuadre el inventario.
 */
export class DeviceImportService {
  constructor(
    private readonly auditPort: AuditPort,
    private readonly db: PrismaClient = prismaClient
  ) {}

  /** Garantiza el tipo genérico (ver `ensureGenericDeviceType`). */
  ensureGenericType(tx: Tx | PrismaClient = this.db) {
    return ensureGenericDeviceType(tx);
  }

  /**
   * Analiza el archivo y regresa exactamente lo que haría la carga, sin tocar
   * la base: es el paso que el usuario revisa antes de confirmar.
   */
  async preview(
    raw: DeviceImportRawRow[],
    typeOverrides: TypeOverrides = new Map(),
    fileHash: string | null = null
  ): Promise<DeviceImportPreview> {
    const plan = await this.plan(raw, typeOverrides);
    const repeatedImport = fileHash ? await this.findRepeatedImport(fileHash) : null;
    return { ...plan, repeatedImport };
  }

  /**
   * Confirma la carga: da de alta los dispositivos nuevos, suma unidades a los
   * que ya existen y registra UN movimiento STOCK_IN por toda la carga (un
   * renglón por dispositivo, con las unidades exactas), para que el kardex de
   * cada dispositivo y la bitácora muestren de dónde salió cada pieza y una
   * carga equivocada se identifique de una sola vez.
   *
   * Con `requestId` la operación es idempotente: la misma petición repetida
   * (doble clic, reintento de red) devuelve el movimiento ya creado y NO vuelve
   * a dar de alta unidades.
   */
  async confirm(
    raw: DeviceImportRawRow[],
    authorId?: string,
    meta: {
      requestId?: string;
      fileName?: string | null;
      fileHash?: string | null;
      allowRepeatFile?: boolean;
    } = {},
    typeOverrides: TypeOverrides = new Map()
  ): Promise<DeviceImportResult> {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    const { requestId, fileName = null, fileHash = null, allowRepeatFile = false } = meta;

    if (requestId) {
      const repeated = await this.movementByRequest(requestId, authorId);
      if (repeated) return repeated;
    }

    const plan = await this.plan(raw, typeOverrides);
    if (plan.summary.invalid > 0) {
      throw new HttpError(400, "DEVICE_IMPORT_HAS_ERRORS", { rows: plan.summary.invalid });
    }
    if (plan.summary.valid === 0) throw new HttpError(400, "DEVICE_IMPORT_EMPTY");
    // Un archivo ya cargado sumaría las unidades otra vez: solo pasa si el usuario lo confirma.
    if (fileHash && !allowRepeatFile) {
      const repeated = await this.findRepeatedImport(fileHash);
      if (repeated) {
        throw new HttpError(409, "DEVICE_FILE_ALREADY_IMPORTED", { movementId: repeated.movementId });
      }
    }

    // Dos cargas simultáneas del mismo archivo pueden planear "alta" las dos y
    // chocar en el único de (tipo, nombre, marca, modelo). La segunda reintenta
    // y, al releer el estado, encuentra el dispositivo y le suma las unidades en
    // vez de duplicarlo.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.createImport(plan, authorId, { requestId, fileName, fileHash });
      } catch (err) {
        if (!this.isDeviceRace(err) || attempt >= 2) {
          if (requestId) {
            const repeated = await this.movementByRequest(requestId, authorId);
            if (repeated) return repeated;
          }
          throw err;
        }
      }
    }
  }

  /** Ejecuta la carga completa en una sola transacción Serializable. */
  private async createImport(
    plan: DevicePlan,
    authorId: string,
    meta: { requestId?: string; fileName: string | null; fileHash: string | null }
  ): Promise<DeviceImportResult> {
    const { requestId, fileName, fileHash } = meta;

    const result = await serializable(this.db, async (tx) => {
      const generic = await this.ensureGenericType(tx);
      const groups = await this.groupRows(tx, plan.rows, generic.id);

      const movementItems: { deviceId: string; quantity: number; unitIds: string[] }[] = [];
      let devicesCreated = 0;
      let devicesReused = 0;

      for (const group of groups) {
        let deviceId = group.deviceId;
        if (!deviceId) {
          const type = await tx.deviceType.findUnique({ where: { id: group.typeId } });
          if (!type || !type.active) throw new HttpError(400, "INVALID_DEVICE_TYPE");
          const device = await tx.device.create({
            data: {
              code: group.code ?? (await generateUniqueDeviceCode(tx)),
              typeId: group.typeId,
              name: group.name,
              brand: group.brand,
              model: group.model,
            },
          });
          deviceId = device.id;
          devicesCreated += 1;
        } else {
          devicesReused += 1;
        }

        // Mismo camino que el alta normal y que la entrada de stock: folios del
        // contador del tipo y unidades DISPONIBLES.
        const unitIds = await createUnits(tx, {
          typeId: group.typeId,
          deviceId,
          quantity: group.quantity,
        });
        movementItems.push({ deviceId, quantity: unitIds.length, unitIds });
      }

      const language = await systemLanguage();
      const file = fileName ?? t("labels.empty", {}, language);
      const movement = await tx.movement.create({
        data: {
          type: "STOCK_IN",
          createdById: authorId,
          reason: t("inventory.bulkImportReason", { file }, language),
          notes: fileName ? t("inventory.bulkImportNotes", { file: fileName }, language) : null,
          items: {
            create: movementItems.map((item) => ({
              deviceId: item.deviceId,
              quantity: item.quantity,
              units: { create: item.unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
            })),
          },
        },
        include: { items: true },
      });

      const unitsCreated = movementItems.reduce((sum, item) => sum + item.quantity, 0);
      const importResult: DeviceImportResult = {
        movementId: movement.id,
        devicesCreated,
        devicesReused,
        unitsCreated,
        rows: plan.summary.valid,
        fileName,
        repeated: false,
      };

      await this.auditPort.createLog(
        {
          action: "MOVEMENT_STOCK_IN",
          entityType: "Movement",
          entityId: movement.id,
          userId: authorId,
          newState: {
            type: "STOCK_IN",
            reason: movement.reason,
            source: "BULK_IMPORT",
            fileName,
            fileHash,
            rows: plan.summary.valid,
            unitsCreated,
            devicesCreated,
            devicesReused,
          },
        },
        tx
      );

      // La clave de idempotencia se guarda DENTRO de la transacción: si la
      // carga se deshace, la clave también, y el usuario puede reintentar.
      if (requestId) {
        await tx.movement.update({ where: { id: movement.id }, data: { requestId } });
      }

      return importResult;
    });

    broadcastDashboardEvent({
      scope: "inventory",
      message: (lng) =>
        t(
          "activity.movementsRegistered",
          { type: label("movementType", "STOCK_IN", lng), count: result.unitsCreated },
          lng
        ),
      targetId: result.movementId,
    }).catch(() => {});

    return result;
  }

  /** Carga anterior con exactamente este contenido (hash SHA-256 guardado en la bitácora). */
  private async findRepeatedImport(fileHash: string): Promise<RepeatedImport | null> {
    const log = await this.db.auditLog.findFirst({
      where: {
        action: "MOVEMENT_STOCK_IN",
        newState: { path: ["fileHash"], equals: fileHash },
      },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, createdAt: true, newState: true },
    });
    if (!log) return null;
    const state = (log.newState ?? {}) as { fileName?: string | null };
    return {
      movementId: log.entityId,
      importedAt: log.createdAt.toISOString(),
      fileName: state.fileName ?? null,
    };
  }

  /** Choque con el único de (tipo, nombre, marca, modelo) o el del código al dar de alta. */
  private isDeviceRace(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      ([] as string[])
        .concat((err.meta?.target as string[] | string) ?? [])
        .some((target) => {
          const text = String(target);
          return text.includes("typeId") || text.includes("code") || text.includes("devices");
        })
    );
  }

  /**
   * Resultado de una petición ya registrada con esa clave. La clave es de quien
   * la usó: otro usuario no puede leer el resultado ajeno.
   */
  private async movementByRequest(
    requestId: string,
    authorId: string
  ): Promise<DeviceImportResult | null> {
    const movement = await this.db.movement.findUnique({
      where: { requestId },
      include: { items: { include: { units: true } } },
    });
    if (!movement) return null;
    if (movement.createdById !== authorId) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");

    return {
      movementId: movement.id,
      devicesCreated: 0,
      devicesReused: 0,
      unitsCreated: movement.items.reduce((sum, item) => sum + item.units.length, 0),
      rows: movement.items.length,
      fileName: null,
      repeated: true,
    };
  }

  /**
   * Resolución única de las filas: valida, busca el tipo (o el genérico) y
   * decide alta vs suma de unidades. La usan la previsualización y la
   * confirmación, así que lo que el usuario revisó es lo que se ejecuta.
   */
  private async plan(
    raw: DeviceImportRawRow[],
    typeOverrides: TypeOverrides
  ): Promise<DevicePlan> {
    if (raw.length > MAX_IMPORT_ROWS) {
      throw new HttpError(400, "DEVICE_IMPORT_TOO_MANY_ROWS", { max: MAX_IMPORT_ROWS });
    }

    const types = await this.db.deviceType.findMany();
    const existingGeneric = types.find(isGenericType) ?? null;

    const typeByKey = new Map<string, (typeof types)[number]>();
    for (const type of types) {
      typeByKey.set(normalizeKey(type.code), type);
      typeByKey.set(normalizeKey(type.name), type);
    }

    // Si el genérico todavía no existe, se planea como si existiera: la
    // confirmación lo crea antes de escribir nada. Así la primera carga de una
    // base sin genérico no sale llena de errores.
    const generic = existingGeneric ?? {
      id: "",
      code: GENERIC_DEVICE_TYPE.code,
      name: GENERIC_DEVICE_TYPE.name,
      assetTagPrefix: freeGenericPrefix(types),
      counter: 0,
    };

    const typeIds = new Set([...types.map((type) => type.id), generic.id]);
    const devices = await this.db.device.findMany({
      where: { typeId: { in: [...typeIds].filter(Boolean) } },
      select: { id: true, typeId: true, code: true, name: true, brand: true, model: true },
    });
    const refs: DeviceRef[] = devices.map((device) => ({ ...device, currentUnits: 0 }));
    const index = this.indexDevices(refs);
    if (refs.length > 0) {
      const counts = await this.db.deviceUnit.groupBy({
        by: ["deviceId"],
        where: { deviceId: { in: refs.map((device) => device.id) } },
        _count: { _all: true },
      });
      const byId = new Map(refs.map((device) => [device.id, device]));
      for (const count of counts) {
        const ref = byId.get(count.deviceId);
        if (ref) ref.currentUnits = count._count._all;
      }
    }

    // Contadores por tipo para mostrar los folios que se van a consumir, en el
    // mismo orden en que la confirmación los consumirá.
    const counters = new Map<string, number>();
    const nextTags = (typeId: string, quantity: number) => {
      const type = types.find((candidate) => candidate.id === typeId);
      const prefix = type?.assetTagPrefix ?? generic.assetTagPrefix;
      const from = (counters.get(typeId) ?? (type?.counter ?? generic.counter)) + 1;
      counters.set(typeId, from + quantity - 1);
      return {
        from: prefix ? formatAssetTag(prefix, from) : null,
        to: prefix ? formatAssetTag(prefix, from + quantity - 1) : null,
      };
    };

    const rows: DeviceImportPreviewRow[] = [];
    // Grupos por dispositivo en orden de primera aparición: es exactamente el
    // orden en el que la confirmación va a consumir los folios de activo.
    const groups: {
      key: string;
      typeId: string;
      code: string | null;
      row: DeviceImportPreviewRow;
      quantity: number;
    }[] = [];
    const groupByKey = new Map<string, (typeof groups)[number]>();
    // Código -> identidad del grupo que lo reclama: dos altas distintas no pueden
    // compartir código dentro del mismo archivo.
    const codeOwners = new Map<string, string>();
    let units = 0;
    let newDevices = 0;
    let existingDevices = 0;
    let genericRows = 0;
    let unknownTypeRows = 0;

    for (const item of raw) {
      const errors: string[] = [];
      const warnings: string[] = [];

      const name = item.name.trim();
      const brand = item.brand.trim() || MISSING_BRAND;
      const model = item.model.trim() || MISSING_MODEL;
      if (isBlank(item.brand)) warnings.push("MISSING_BRAND");
      if (isBlank(item.model)) warnings.push("MISSING_MODEL");
      if (!name) errors.push("MISSING_NAME");

      const quantity = Number(String(item.quantity).trim());
      if (!Number.isInteger(quantity) || quantity < 1) errors.push("INVALID_QUANTITY");
      else if (quantity > MAX_ROW_QUANTITY) errors.push("QUANTITY_TOO_LARGE");

      // Orden: el tipo elegido en pantalla gana; si no hay, el del archivo; si
      // tampoco, el genérico. Así una fila sin tipo o con tipo desconocido se
      // puede asignar a mano sin tocar el archivo.
      const wantsType = !isBlank(item.typeName);
      const fileMatch = wantsType ? typeByKey.get(normalizeKey(item.typeName)) : undefined;
      const chosenId = typeOverrides.get(item.row);
      const chosen = chosenId ? types.find((candidate) => candidate.id === chosenId) : undefined;
      if (chosenId && (!chosen || !chosen.active)) throw new HttpError(400, "INVALID_DEVICE_TYPE");
      const typeOverridden = Boolean(chosen);
      const typeUnknown = wantsType && !fileMatch && !typeOverridden;
      const typeMissing = !wantsType && !typeOverridden;
      if (typeUnknown) unknownTypeRows += 1;

      const target = chosen ?? fileMatch ?? generic;
      if (target.code === generic.code) genericRows += 1;
      const code = normalizeDeviceCode(item.code);
      const resolved = this.resolveDevice(index, {
        typeId: target.id,
        code,
        name,
        brand,
        model,
      });
      if (resolved.error) errors.push(resolved.error);
      const existing = resolved.existing;
      // El código manda: el dispositivo ya existe con otro nombre (el proveedor
      // lo renombró). Se suman unidades al registro que ya está y se avisa.
      if (
        existing &&
        resolved.via === "CODE" &&
        this.deviceKey(existing.typeId, existing.name, existing.brand, existing.model) !==
          this.deviceKey(target.id, name, brand, model)
      ) {
        warnings.push("CODE_DATA_DIFFERS");
      }
      // Empatado solo por marca+modelo: el nombre (o el tipo) del archivo es otro.
      if (resolved.via === "MODEL") warnings.push("MODEL_MATCHED_OTHER_NAME");

      const row: DeviceImportPreviewRow = {
        row: item.row,
        typeName: item.typeName.trim(),
        resolvedTypeName: target.name,
        resolvedTypeCode: target.code,
        typeUnknown,
        typeMissing,
        typeOverridden,
        code: existing ? existing.code : code,
        deviceId: existing?.id ?? null,
        typeId: existing ? existing.typeId : target.id || null,
        name,
        brand,
        model,
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
        action: existing ? "ADD_UNITS" : "CREATE",
        mergedRows: [],
        currentUnits: existing?.currentUnits ?? 0,
        assetTagFrom: null,
        assetTagTo: null,
        warnings,
        errors,
      };

      const identity = existing
        ? `id:${existing.id}`
        : `new:${this.deviceKey(target.id, name, brand, model)}`;
      if (errors.length === 0 && code) {
        const owner = codeOwners.get(code);
        if (owner && owner !== identity) errors.push("CODE_DUPLICATED_IN_FILE");
      }
      if (errors.length === 0 && code && !existing) {
        const group = groupByKey.get(identity);
        if (group?.code && group.code !== code) errors.push("CODE_CONFLICT_IN_FILE");
      }

      if (errors.length === 0) {
        if (code) codeOwners.set(code, identity);
        const group = groupByKey.get(identity);
        if (group) {
          // Otra fila del mismo archivo cae en el mismo dispositivo: se suman
          // en UN solo renglón de movimiento (y se avisa en la previsualización).
          group.quantity += row.quantity;
          if (!group.code) group.code = code;
          group.row.mergedRows.push(row.row);
          row.mergedRows = [group.row.row];
        } else {
          const created = {
            key: identity,
            typeId: existing ? existing.typeId : target.id,
            code,
            row,
            quantity: row.quantity,
          };
          groupByKey.set(identity, created);
          groups.push(created);
          if (existing) existingDevices += 1;
          else newDevices += 1;
        }
        units += row.quantity;
      }

      rows.push(row);
    }

    // Los folios se asignan por grupo (no por fila) porque el grupo es lo que
    // realmente consume el contador del tipo, en este mismo orden.
    for (const group of groups) {
      const range = nextTags(group.typeId, group.quantity);
      group.row.assetTagFrom = range.from;
      group.row.assetTagTo = range.to;
    }

    if (units > MAX_IMPORT_UNITS) {
      throw new HttpError(400, "DEVICE_IMPORT_TOO_MANY_UNITS", { max: MAX_IMPORT_UNITS });
    }

    const invalid = rows.filter((row) => row.errors.length > 0).length;
    return {
      rows,
      summary: {
        rows: rows.length,
        valid: rows.length - invalid,
        invalid,
        units,
        newDevices,
        existingDevices,
        genericRows,
        unknownTypeRows,
        typesToCreate: existingGeneric ? [] : [GENERIC_DEVICE_TYPE.name],
      },
    };
  }

  /**
   * Reagrupa las filas válidas por dispositivo destino (mismo tipo, nombre,
   * marca y modelo) para que un archivo con el mismo dispositivo repetido en
   * varias filas genere UN dispositivo y UN renglón de movimiento. Es la
   * resolución autoritativa: se corre dentro de la transacción, contra el
   * estado real, por si algo cambió entre la previsualización y la confirmación.
   */
  /**
   * Dispositivo al que cae una fila. Con código manda el código: un proveedor que
   * le cambió el nombre al producto sigue cayendo en su mismo dispositivo. Sin
   * código, cuenta el nombre (tipo+nombre+marca+modelo), como antes. Un código
   * nuevo cuyo nombre ya existe con OTRO código sería un duplicado: se rechaza.
   */
  private resolveDevice(
    index: DeviceIndex,
    fields: { typeId: string; code: string | null; name: string; brand: string; model: string }
  ): { existing: DeviceRef | null; via: DeviceMatch; error: string | null } {
    const none = { existing: null, via: null, error: null };
    const byKey = index.byKey.get(
      this.deviceKey(fields.typeId, fields.name, fields.brand, fields.model)
    );
    const byModel = this.modelCandidates(index, fields);

    if (fields.code) {
      const byCode = index.byCode.get(fields.code);
      if (byCode) return { existing: byCode, via: "CODE", error: null };
      // Mismo nombre o mismo modelo ya dados de alta con OTRO código: crearlo duplicaría el producto.
      if (byKey) return { ...none, error: "DEVICE_NAME_TAKEN_BY_OTHER_CODE" };
      if (byModel.length > 0) return { ...none, error: "MODEL_TAKEN_BY_OTHER_CODE" };
      return none;
    }

    if (byKey) return { existing: byKey, via: "NAME", error: null };
    // Sin código ni nombre igual: el proveedor pudo renombrar el producto. Se empata por
    // marca+modelo solo si es inequívoco (y no son los placeholders SIN MARCA/SIN MODELO).
    if (byModel.length === 1) return { existing: byModel[0], via: "MODEL", error: null };
    if (byModel.length > 1) return { ...none, error: "MODEL_AMBIGUOUS" };
    return none;
  }

  private modelCandidates(
    index: DeviceIndex,
    fields: { brand: string; model: string }
  ): DeviceRef[] {
    if (fields.brand === MISSING_BRAND || fields.model === MISSING_MODEL) return [];
    return index.byModel.get(modelKeyOf(fields.brand, fields.model)) ?? [];
  }

  private indexDevices(devices: DeviceRef[]): DeviceIndex {
    const byCode = new Map<string, DeviceRef>();
    const byKey = new Map<string, DeviceRef>();
    const byModel = new Map<string, DeviceRef[]>();
    for (const device of devices) {
      byKey.set(this.deviceKey(device.typeId, device.name, device.brand, device.model), device);
      if (device.code) byCode.set(device.code, device);
      const key = modelKeyOf(device.brand, device.model);
      byModel.set(key, [...(byModel.get(key) ?? []), device]);
    }
    return { byCode, byKey, byModel };
  }

  /**
   * Agrupa las filas válidas por dispositivo dentro de la transacción de la
   * confirmación. Vuelve a resolver contra la base (no confía en la previsualización),
   * así un choque con otra carga se detecta antes de escribir.
   */
  private async groupRows(
    tx: Tx,
    rows: DeviceImportPreviewRow[],
    genericTypeId: string
  ): Promise<DeviceGroup[]> {
    const devices = await tx.device.findMany({
      select: { id: true, typeId: true, code: true, name: true, brand: true, model: true },
    });
    const index = this.indexDevices(devices.map((device) => ({ ...device, currentUnits: 0 })));

    const groups = new Map<string, DeviceGroup>();
    for (const row of rows) {
      if (row.errors.length > 0) continue;
      const typeId = row.typeId ?? genericTypeId;
      const { existing, error } = this.resolveDevice(index, {
        typeId,
        code: row.code,
        name: row.name,
        brand: row.brand,
        model: row.model,
      });
      if (error) throw new HttpError(409, "DEVICE_IMPORT_CHANGED", { error });

      const identity = existing
        ? `id:${existing.id}`
        : `new:${this.deviceKey(typeId, row.name, row.brand, row.model)}`;
      const group = groups.get(identity);
      if (group) {
        group.quantity += row.quantity;
        if (!group.code) group.code = row.code;
        continue;
      }
      groups.set(identity, {
        typeId: existing ? existing.typeId : typeId,
        deviceId: existing?.id ?? null,
        code: row.code,
        name: row.name,
        brand: row.brand,
        model: row.model,
        quantity: row.quantity,
      });
    }
    return [...groups.values()];
  }

  private deviceKey(typeId: string, name: string, brand: string, model: string): string {
    return [typeId, normalizeKey(name), normalizeKey(brand), normalizeKey(model)].join("|");
  }
}
