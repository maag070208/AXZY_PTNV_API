import type { APIRequestContext, APIResponse } from "@playwright/test";

export type Status = "AVAILABLE" | "ON_LOAN" | "DAMAGED" | "IN_MAINTENANCE" | "RETIRED";
export type Condition = "GOOD" | "FAIR" | "POOR" | "BROKEN";
export type MovementType =
  | "STOCK_IN"
  | "LOAN"
  | "RETURN"
  | "RETIREMENT"
  | "TRANSFER"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "MAINTENANCE_IN"
  | "MAINTENANCE_OUT"
  | "REVERSAL";

export interface DeviceType {
  id: string;
  code: string;
  name: string;
  assetTagPrefix: string;
  counter: number;
  active: boolean;
}

export interface Device {
  id: string;
  typeId: string;
  name: string;
  brand: string;
  model: string;
}

export interface Unit {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  macAddress: string | null;
  ip: string | null;
  hostname: string | null;
  area: string;
  status: Status;
  departmentId: string | null;
  deviceId: string;
}

/** Lo que devuelve `GET /inventario/unidades?q=`: la unidad ya resuelta con su catálogo. */
export interface SearchedUnit extends Unit {
  department: { id: string; name: string } | null;
  device: {
    id: string;
    name: string;
    brand: string;
    model: string;
    type: { id: string; name: string; assetTagPrefix: string };
  };
}

export interface Stock extends Record<Status, number> {
  active: number;
  historical: number;
}

export interface MovementItem {
  id: string;
  deviceId: string;
  quantity: number;
  condition: Condition | null;
  notes: string | null;
  /** Unidades exactas que movió el renglón (los folios de activo fijo). */
  units: { deviceUnitId: string; deviceUnit?: Unit }[];
}

export interface Movement {
  id: string;
  type: MovementType;
  userId: string;
  custodianId: string | null;
  departmentId: string | null;
  reason: string | null;
  notes: string | null;
  status: "ACTIVE" | "CANCELLED";
  reversalOfId: string | null;
  items: MovementItem[];
}

export interface LoanItem {
  id: string;
  deviceId: string;
  quantity: number;
  returnedQuantity: number;
}

export interface Loan {
  id: string;
  number: string;
  status: "ACTIVE" | "PARTIAL" | "RETURNED" | "CANCELLED";
  movementId: string | null;
  custodianId: string | null;
  departmentId: string | null;
  notes: string | null;
  items: LoanItem[];
  returns: { id: string; number: string }[];
}

export interface StockLedgerRow {
  type: MovementType;
  stockIn: number;
  stockOut: number;
  balance: number;
  condition: Condition | null;
  reason: string | null;
}

export interface StockLedger {
  device: Device;
  stock: Stock;
  rows: StockLedgerRow[];
}

/** Conteo por estado que agrega `GET /inventory/devices?stock=true`. */
export interface DeviceStock {
  total: number;
  AVAILABLE: number;
  ON_LOAN: number;
  DAMAGED: number;
  IN_MAINTENANCE: number;
  RETIRED: number;
}

/** Dispositivo con su tipo y, con `?stock=true`, sus existencias. */
export interface DeviceWithStock extends Device {
  type?: DeviceType;
  stock?: DeviceStock;
}

export interface InventoryAuditCheck {
  key: string;
  count: number;
  samples: string[];
  /** Detalle en piezas del caso (hoy solo la regla de movimientos). */
  rows?: {
    movementType?: string;
    date?: string;
    device?: string;
    quantity?: number;
    linked?: number;
  }[];
}

export interface InventoryAuditResult {
  ok: boolean;
  checkedAt: string;
  checks: InventoryAuditCheck[];
}

export interface InventoryDashboard {
  stats: {
    types: number;
    devices: number;
    activeUnits: number;
    available: number;
    loaned: number;
    damaged: number;
    maintenance: number;
    retirement: number;
  };
  byType: Array<{
    id: string;
    code: string;
    name: string;
    devices: Array<{
      id: string;
      name: string;
      available: number;
      loaned: number;
      damaged: number;
      maintenance: number;
      retirement: number;
      total: number;
    }>;
  }>;
}

/** Un renglón del historial de una pieza (`GET /inventory/units/:id/history`). */
export interface UnitHistoryEntry {
  kind: "MOVEMENT" | "LOAN" | "RETURN" | "AUDIT";
  date: string;
  type?: string;
  status?: string;
  author?: string | null;
  condition?: Condition | null;
  reason?: string | null;
  notes?: string | null;
  movementId?: string;
  loanId?: string;
  number?: string;
  loanNumber?: string;
  returned?: boolean;
  custodian?: string | null;
  department?: string | null;
  action?: string;
  metadata?: unknown;
}

export interface UnitHistory {
  unit: Unit & {
    department: { id: string; name: string } | null;
    device: {
      id: string;
      name: string;
      brand: string;
      model: string;
      type: { id: string; name: string };
    };
  };
  history: UnitHistoryEntry[];
}

export interface LoanReturnItem {
  id: string;
  loanReturnId: string;
  loanItemId: string;
  deviceId: string;
  quantity: number;
  condition: Condition;
  notes: string | null;
  device?: { id: string; name: string };
}

/** Devolución como la devuelve `GET /inventory/returns`. */
export interface LoanReturn {
  id: string;
  number: string;
  date: string;
  loanId: string;
  movementId: string;
  custodianId: string | null;
  notes: string | null;
  loan: {
    id: string;
    number: string;
    custodian: { name: string } | null;
    department: { name: string } | null;
  };
  items: LoanReturnItem[];
}

/** Respuesta cruda, para los casos donde lo que se verifica es el error. */
export interface Res<T> {
  status: number;
  body: T;
}

/** Un archivo .xlsx en memoria, tal como lo manda el navegador. */
export interface UploadFile {
  name: string;
  buffer: Buffer;
}

export type ImportAction = "CREATE" | "ADD_UNITS";

/** Un renglón ya resuelto de la carga masiva (lo que la API va a hacer). */
export interface ImportPreviewRow {
  row: number;
  typeName: string;
  resolvedTypeName: string;
  resolvedTypeCode: string;
  typeUnknown: boolean;
  typeMissing: boolean;
  name: string;
  brand: string;
  model: string;
  quantity: number;
  action: ImportAction;
  mergedRows: number[];
  currentUnits: number;
  assetTagFrom: string | null;
  assetTagTo: string | null;
  warnings: string[];
  errors: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: {
    rows: number;
    valid: number;
    invalid: number;
    units: number;
    newDevices: number;
    existingDevices: number;
    genericRows: number;
    unknownTypeRows: number;
    typesToCreate: string[];
  };
}

export interface ImportResult {
  movementId: string;
  devicesCreated: number;
  devicesReused: number;
  unitsCreated: number;
  rows: number;
  fileName: string | null;
  repeated: boolean;
}

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

/**
 * `baseURL` incluye el prefijo `/api/v1`, y `new URL("/x", base)` lo borraría:
 * las rutas viajan siempre relativas.
 */
const route = (path: string): string => path.replace(/^\/+/, "");

const read = async <T>(res: APIResponse): Promise<Res<T>> => {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status(), body: body as T };
};

/**
 * Cliente del módulo de inventario sobre la API real.
 *
 * Los métodos con nombre de negocio (`crearTipo`, `prestar`, `darDeBaja`…)
 * exigen el status de éxito y devuelven el cuerpo ya tipado, para que los tests
 * se lean como la especificación funcional. Para los caminos de error están los
 * métodos crudos `post`/`get`/`put`, que nunca lanzan.
 */
export class InventoryApi {
  constructor(private readonly request: APIRequestContext) {}

  // --- Crudos: no lanzan, devuelven status + cuerpo ---------------------------
  async post<T = ErrorBody>(
    path: string,
    data?: unknown,
    headers?: Record<string, string>
  ): Promise<Res<T>> {
    return read<T>(await this.request.post(route(path), { data: data ?? {}, headers }));
  }

  /** POST con `Idempotency-Key` explícita (repite la petición sin duplicarla). */
  async postWithKey<T = ErrorBody>(path: string, key: string, data?: unknown): Promise<Res<T>> {
    return this.post<T>(path, data, { "Idempotency-Key": key });
  }

  async get<T = ErrorBody>(path: string): Promise<Res<T>> {
    return read<T>(await this.request.get(route(path)));
  }

  async put<T = ErrorBody>(path: string, data?: unknown): Promise<Res<T>> {
    return read<T>(await this.request.put(route(path), { data: data ?? {} }));
  }

  async from<T = ErrorBody>(path: string): Promise<Res<T>> {
    return read<T>(await this.request.delete(route(path)));
  }

  private async require<T>(res: Res<T | ErrorBody>, expected: number, action: string): Promise<T> {
    if (res.status !== expected) {
      throw new Error(
        `${action}: se esperaba HTTP ${expected} y la API respondió ${res.status} → ${JSON.stringify(res.body)}`
      );
    }
    return res.body as T;
  }

  // --- Catálogo y alta -------------------------------------------------------
  async createType(input: {
    code: string;
    name: string;
    assetTagPrefix: string;
    useSerialNumber?: boolean;
    useMac?: boolean;
    useIp?: boolean;
    useHostname?: boolean;
  }): Promise<DeviceType> {
    return this.require(await this.post<DeviceType>("/inventory/device-types", input), 201, "createType");
  }

  async listTypes(): Promise<DeviceType[]> {
    return this.require(await this.get<DeviceType[]>("/inventory/device-types"), 200, "listTypes");
  }

  // --- Carga masiva por Excel ------------------------------------------------
  // Se manda el archivo (multipart) igual que el navegador: la API lo vuelve a
  // leer en cada paso, no confía en lo que la UI dice que leyó.

  /**
   * Petición multipart de la subida. No se fija `Content-Type`: Playwright pone
   * el `multipart/form-data` con su boundary. (El contexto de las fixtures ya no
   * impone `application/json`, así que no hay encabezado que sobrescribir.)
   */
  private fileRequest(file: UploadFile, key?: string) {
    return {
      multipart: {
        file: {
          name: file.name,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: file.buffer,
        },
      },
      headers: key ? { "Idempotency-Key": key } : undefined,
    };
  }

  /** Paso 1: qué haría la carga. No escribe nada. */
  async previewDeviceImport(file: UploadFile): Promise<Res<ImportPreview | ErrorBody>> {
    return read<ImportPreview | ErrorBody>(
      await this.request.post(route("/inventory/devices/import/preview"), this.fileRequest(file))
    );
  }

  /** Paso 2: la carga real. Con `key` la petición repetida no duplica nada. */
  async importDevices(
    file: UploadFile,
    key?: string
  ): Promise<Res<ImportResult | ErrorBody>> {
    return read<ImportResult | ErrorBody>(
      await this.request.post(route("/inventory/devices/import"), this.fileRequest(file, key))
    );
  }

  /** Plantilla Excel (encabezados + catálogo de tipos). */
  async deviceImportTemplate(): Promise<{ status: number; contentType: string; buffer: Buffer }> {
    const res = await this.request.get(route("/inventory/devices/import/template"));
    return {
      status: res.status(),
      contentType: res.headers()["content-type"] ?? "",
      buffer: await res.body(),
    };
  }

  async type(id: string): Promise<DeviceType> {
    const types = await this.listTypes();
    const type = types.find((t) => t.id === id);
    if (!type) throw new Error(`Tipo ${id} no encontrado en el catálogo`);
    return type;
  }

  async createDevice(input: {
    typeId: string;
    name: string;
    brand: string;
    model: string;
    description?: string;
    notes?: string;
    initialQuantity?: number;
    units?: { serialNumber?: string; macAddress?: string; ip?: string; hostname?: string }[];
  }): Promise<Device> {
    return this.require(
      await this.post<Device>("/inventory/devices", input),
      201,
      "createDevice"
    );
  }

  async stock(deviceId: string): Promise<Stock> {
    return this.require(
      await this.get<Stock>(`/inventory/devices/${deviceId}/stock`),
      200,
      "stock"
    );
  }

  async units(deviceId: string): Promise<Unit[]> {
    return this.require(
      await this.get<Unit[]>(`/inventory/devices/${deviceId}/units`),
      200,
      "units"
    );
  }

  async searchUnits(q: string, limit?: number): Promise<SearchedUnit[]> {
    const qs = new URLSearchParams({ q });
    if (limit !== undefined) qs.set("limit", String(limit));
    return this.require(
      await this.get<SearchedUnit[]>(`/inventory/units?${qs.toString()}`),
      200,
      "searchUnits"
    );
  }

  async stockLedger(deviceId: string): Promise<StockLedger> {
    return this.require(
      await this.get<StockLedger>(`/inventory/devices/${deviceId}/ledger`),
      200,
      "stockLedger"
    );
  }

  // --- Dispositivos, tipos y unidades (lectura y edición) --------------------
  async listDevices(filters: { q?: string; typeId?: string; stock?: boolean } = {}): Promise<DeviceWithStock[]> {
    const qs = new URLSearchParams(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();
    return this.require(
      await this.get<DeviceWithStock[]>(`/inventory/devices${qs ? `?${qs}` : ""}`),
      200,
      "listDevices"
    );
  }

  async device(id: string): Promise<DeviceWithStock> {
    return this.require(await this.get<DeviceWithStock>(`/inventory/devices/${id}`), 200, "device");
  }

  async updateDevice(
    id: string,
    input: { name?: string; brand?: string; model?: string; description?: string; notes?: string }
  ): Promise<Device> {
    return this.require(await this.put<Device>(`/inventory/devices/${id}`, input), 200, "updateDevice");
  }

  async deleteDevice(id: string): Promise<Device> {
    return this.require(await this.from<Device>(`/inventory/devices/${id}`), 200, "deleteDevice");
  }

  async updateType(
    id: string,
    input: {
      name?: string;
      assetTagPrefix?: string;
      active?: boolean;
      useSerialNumber?: boolean;
      useMac?: boolean;
      useIp?: boolean;
      useHostname?: boolean;
    }
  ): Promise<DeviceType> {
    return this.require(await this.put<DeviceType>(`/inventory/device-types/${id}`, input), 200, "updateType");
  }

  async deleteType(id: string): Promise<DeviceType> {
    return this.require(await this.from<DeviceType>(`/inventory/device-types/${id}`), 200, "deleteType");
  }

  async updateUnit(
    id: string,
    input: {
      serialNumber?: string;
      macAddress?: string;
      ip?: string;
      hostname?: string;
      area?: string;
    }
  ): Promise<Unit> {
    return this.require(await this.put<Unit>(`/inventory/units/${id}`, input), 200, "updateUnit");
  }

  async unitHistory(id: string): Promise<UnitHistory> {
    return this.require(
      await this.get<UnitHistory>(`/inventory/units/${id}/history`),
      200,
      "unitHistory"
    );
  }

  async audit(): Promise<InventoryAuditResult> {
    return this.require(await this.get<InventoryAuditResult>("/inventory/audit"), 200, "audit");
  }

  async dashboard(): Promise<InventoryDashboard> {
    return this.require(await this.get<InventoryDashboard>("/inventory/dashboard"), 200, "dashboard");
  }

  // --- Movimientos -----------------------------------------------------------
  async movement(input: {
    type: "STOCK_IN" | "RETIREMENT" | "MAINTENANCE_IN" | "MAINTENANCE_OUT";
    reason?: string;
    notes?: string;
    idempotencyKey?: string;
    items: {
      deviceId: string;
      quantity?: number;
      condition?: Condition;
      unitId?: string;
      unitIds?: string[];
      /** Identidad de las piezas nuevas de una entrada (opcional por pieza). */
      units?: { serialNumber?: string; macAddress?: string; ip?: string; hostname?: string }[];
      notes?: string;
    }[];
  }): Promise<Movement> {
    const { idempotencyKey, ...body } = input;
    const res = idempotencyKey
      ? await this.postWithKey<Movement>("/inventory/movements", idempotencyKey, body)
      : await this.post<Movement>("/inventory/movements", body);
    return this.require(res, 201, `movimiento ${input.type}`);
  }

  async viewMovement(id: string): Promise<Movement> {
    return this.require(await this.get<Movement>(`/inventory/movements/${id}`), 200, "viewMovement");
  }

  async listMovements(filters: { type?: string; deviceId?: string } = {}): Promise<Movement[]> {
    const qs = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return this.require(
      await this.get<Movement[]>(`/inventory/movements${qs ? `?${qs}` : ""}`),
      200,
      "listMovements"
    );
  }

  async revert(movementId: string): Promise<Movement> {
    return this.require(
      await this.post<Movement>(`/inventory/movements/${movementId}/revert`),
      201,
      "revert"
    );
  }

  // --- Préstamos y devoluciones ---------------------------------------------
  /**
   * `POST /inventario/prestamos` devuelve el *movimiento*, no el préstamo, así
   * que aquí se resuelve el préstamo asociado para que los tests trabajen con
   * la entidad de negocio (consecutivo, status, detalles).
   */
  async lend(input: {
    custodianId?: string;
    departmentId?: string;
    subareaId?: string;
    notes?: string;
    idempotencyKey?: string;
    items: { deviceId: string; quantity?: number; unitIds?: string[] }[];
  }): Promise<{ movement: Movement; loan: Loan }> {
    const { idempotencyKey, ...body } = input;
    const res = idempotencyKey
      ? await this.postWithKey<Movement>("/inventory/loans", idempotencyKey, body)
      : await this.post<Movement>("/inventory/loans", body);
    const movement = await this.require(res, 201, "lend");
    const loan = await this.movementLoan(movement.id);
    return { movement, loan };
  }

  async listLoans(filters: { status?: string; custodianId?: string } = {}): Promise<Loan[]> {
    const qs = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return this.require(
      await this.get<Loan[]>(`/inventory/loans${qs ? `?${qs}` : ""}`),
      200,
      "listLoans"
    );
  }

  async movementLoan(movementId: string): Promise<Loan> {
    const loans = await this.listLoans();
    const loan = loans.find((p) => p.movementId === movementId);
    if (!loan) throw new Error(`No hay préstamo ligado al movimiento ${movementId}`);
    return loan;
  }

  async loan(id: string): Promise<Loan> {
    return this.require(await this.get<Loan>(`/inventory/loans/${id}`), 200, "loan");
  }

  async returnLoan(input: {
    loanId: string;
    custodianId?: string;
    notes?: string;
    idempotencyKey?: string;
    items: {
      loanItemId: string;
      quantity?: number;
      unitIds?: string[];
      condition: Condition;
      notes?: string;
    }[];
  }): Promise<Movement> {
    const { idempotencyKey, ...body } = input;
    const res = idempotencyKey
      ? await this.postWithKey<Movement>("/inventory/returns", idempotencyKey, body)
      : await this.post<Movement>("/inventory/returns", body);
    return this.require(res, 201, "returnLoan");
  }

  async listReturns(filters: { loanId?: string } = {}): Promise<LoanReturn[]> {
    const qs = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return this.require(
      await this.get<LoanReturn[]>(`/inventory/returns${qs ? `?${qs}` : ""}`),
      200,
      "listReturns"
    );
  }

  async cancelLoan(id: string): Promise<Loan> {
    return this.require(
      await this.post<Loan>(`/inventory/loans/${id}/cancel`),
      200,
      "cancelLoan"
    );
  }

  async updateLoan(
    id: string,
    input: {
      custodianId?: string;
      departmentId?: string;
      subareaId?: string;
      notes?: string;
      deviceId?: string;
      quantity?: number;
      unitIds?: string[];
    }
  ): Promise<Loan> {
    return this.require(
      await this.put<Loan>(`/inventory/loans/${id}`, input),
      200,
      "updateLoan"
    );
  }

  // --- Atajos de negocio -----------------------------------------------------
  retire(deviceId: string, quantity: number, reason: string, unitId?: string) {
    return this.movement({
      type: "RETIREMENT",
      reason,
      items: [{ deviceId, quantity, ...(unitId ? { unitId } : {}) }],
    });
  }

  /** Entrada de piezas NUEVAS a un dispositivo que ya existe. */
  addUnits(
    deviceId: string,
    quantity: number,
    extra: { reason?: string; notes?: string; units?: { serialNumber?: string; macAddress?: string; ip?: string; hostname?: string }[] } = {}
  ) {
    const { units, ...meta } = extra;
    return this.movement({ type: "STOCK_IN", items: [{ deviceId, quantity, ...(units ? { units } : {}) }], ...meta });
  }

  sendToMaintenance(deviceId: string, quantity: number, reason?: string, unitId?: string) {
    return this.movement({
      type: "MAINTENANCE_IN",
      reason,
      items: [{ deviceId, quantity, ...(unitId ? { unitId } : {}) }],
    });
  }

  removeFromMaintenance(deviceId: string, quantity: number, condition: Condition, unitId?: string) {
    return this.movement({
      type: "MAINTENANCE_OUT",
      items: [{ deviceId, quantity, condition, ...(unitId ? { unitId } : {}) }],
    });
  }
}
