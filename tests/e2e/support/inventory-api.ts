import type { APIRequestContext, APIResponse } from "@playwright/test";

export type Status = "AVAILABLE" | "ON_LOAN" | "DAMAGED" | "IN_MAINTENANCE" | "RETIREMENT";
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

/** Respuesta cruda, para los casos donde lo que se verifica es el error. */
export interface Res<T> {
  status: number;
  body: T;
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
  async post<T = ErrorBody>(path: string, data?: unknown): Promise<Res<T>> {
    return read<T>(await this.request.post(route(path), { data: data ?? {} }));
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

  // --- Movimientos -----------------------------------------------------------
  async movement(input: {
    type: "RETIREMENT" | "MAINTENANCE_IN" | "MAINTENANCE_OUT";
    reason?: string;
    notes?: string;
    items: {
      deviceId: string;
      quantity: number;
      condition?: Condition;
      unitId?: string;
      notes?: string;
    }[];
  }): Promise<Movement> {
    return this.require(
      await this.post<Movement>("/inventory/movements", input),
      201,
      `movimiento ${input.type}`
    );
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
    items: { deviceId: string; quantity: number }[];
  }): Promise<{ movement: Movement; loan: Loan }> {
    const movement = await this.require(
      await this.post<Movement>("/inventory/loans", input),
      201,
      "lend"
    );
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
    items: {
      loanItemId: string;
      quantity: number;
      condition: Condition;
      notes?: string;
    }[];
  }): Promise<Movement> {
    return this.require(
      await this.post<Movement>("/inventory/returns", input),
      201,
      "returnLoan"
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
