import type { APIRequestContext } from "@playwright/test";

/** Cliente tipado mínimo del almacén de cocina para los tests de contrato. */
export interface KitchenUnitRef {
  id: string;
  code: string;
  name: string;
  whole: boolean;
  active: boolean;
}

export interface KitchenItemRow {
  id: string;
  code: string;
  name: string;
  unit: KitchenUnitRef;
  available: number;
  minStock: number;
  maxStock: number | null;
  stockStatus: string;
}

export interface KitchenItemDetail {
  id: string;
  code: string;
  available: number;
  stockValue: number;
  lots: Array<{ id: string; lotCode: string; onHand: number; unitCost: number | null }>;
}

export interface RestockRow {
  id: string;
  code: string;
  name: string;
  available: number;
  inTransit: number;
  suggested: number;
  unit: KitchenUnitRef;
}

export interface PurchaseOrderLine {
  id: string;
  item: { id: string; code: string; name: string };
  quantity: number;
  unitCost: number | null;
  receivedQuantity: number;
  pendingQuantity: number;
  taxRateId: string | null;
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface PurchaseOrderDetail {
  id: string;
  number: string;
  status: string;
  supplier: { id: string; name: string; email?: string | null; primaryContact?: { email: string | null } | null };
  costCenter: { id: string; name: string; code: string } | null;
  sentAt?: string | null;
  lines: PurchaseOrderLine[];
  movements: Array<{ id: string }>;
}

export interface CostCenterRow {
  id: string;
  name: string;
  code: string;
  department: { id: string; name: string } | null;
  active: boolean;
}

export interface CostCenterSpending {
  from: string | null;
  to: string | null;
  rows: Array<{ costCenter: { id: string; name: string; code: string } | null; orders: number; subtotal: number; tax: number; total: number }>;
  totals: { orders: number; subtotal: number; tax: number; total: number };
}

export interface InvoiceLine {
  id: string;
  item: { code: string };
  quantity: number;
  unitCost: number;
  ordered: number | null;
  received: number | null;
  invoicedQuantity: number | null;
  priceDiff: number | null;
  taxRateId: string | null;
  taxRate: number;
  tax: number;
  poTaxRate: number | null;
  taxRateDiff: number | null;
  taxDiff: number | null;
}

export interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  total: number;
  purchaseOrder: { id: string; number: string } | null;
  taxTotals: {
    subtotal: number;
    tax: number;
    total: number;
    byRate: Array<{ rate: number; base: number; tax: number }>;
    order: { subtotal: number; tax: number; total: number; byRate: Array<{ rate: number; base: number; tax: number }> } | null;
    taxDiff: number | null;
  };
  lines: InvoiceLine[];
}

interface Result<T> {
  status: number;
  body: T;
}

const idempotency = (key?: string): Record<string, string> | undefined =>
  key ? { "Idempotency-Key": key } : undefined;

/** Un renglón de la previsualización de la carga masiva. */
export interface KitchenImportPreviewRow {
  row: number;
  code: string;
  codeDerived: boolean;
  name: string;
  categoryName: string;
  categoryNew: boolean;
  unitName: string;
  unitNew: boolean;
  quantity: number;
  expiresAt: string | null;
  action: "CREATE" | "ADD" | "SET_UP" | "SET_DOWN" | "SET_SAME" | "NO_STOCK";
  delta: number;
  currentStock: number | null;
  resultingStock: number | null;
  lotCode: string | null;
  warnings: string[];
  errors: string[];
}

export interface KitchenImportPreview {
  strategy: "ADD" | "SET";
  rows: KitchenImportPreviewRow[];
  summary: {
    rows: number;
    valid: number;
    invalid: number;
    itemsToCreate: number;
    existingItems: number;
    lots: number;
    quantityIn: number;
    adjustedOut: number;
    quantityOut: number;
    withoutStock: number;
    categoriesToCreate: string[];
    unitsToCreate: string[];
  };
}

export interface KitchenImportResult {
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
  repeated: boolean;
}

export class KitchenApi {
  constructor(private readonly ctx: APIRequestContext) {}

  private async send<T>(method: "post" | "patch" | "get", path: string, data?: unknown, headers?: Record<string, string>): Promise<Result<T>> {
    const res =
      method === "get"
        ? await this.ctx.get(path)
        : method === "post"
          ? await this.ctx.post(path, { data, headers })
          : await this.ctx.patch(path, { data });
    const body = (await res.json().catch(() => null)) as T;
    return { status: res.status(), body };
  }

  /**
   * Envío multipart armado a mano: el contexto de la suite trae JSON por defecto
   * y un `Content-Type` fijo rompería el parser de Express.
   */
  multipart = async <T>(
    path: string,
    form: { file?: { buffer: Buffer; filename: string; mimeType: string }; fields?: Record<string, string> },
    key?: string
  ): Promise<Result<T>> => {
    const boundary = `----E2EBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const chunks: Buffer[] = [];
    for (const [name, value] of Object.entries(form.fields ?? {})) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
    }
    if (form.file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.file.filename}"\r\nContent-Type: ${form.file.mimeType}\r\n\r\n`,
          "utf8"
        )
      );
      chunks.push(form.file.buffer);
      chunks.push(Buffer.from("\r\n", "utf8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

    const res = await this.ctx.post(path, {
      data: Buffer.concat(chunks),
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
    });
    const body = (await res.json().catch(() => null)) as T;
    return { status: res.status(), body };
  };

  /** Carga masiva del inventario: previsualización (no escribe) y confirmación. */
  previewItemImport = (file: Buffer, strategy?: "ADD" | "SET") =>
    this.multipart<KitchenImportPreview>("kitchen/items/import/preview", {
      file: { buffer: file, filename: "inventario.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      fields: strategy ? { strategy } : undefined,
    });
  importItems = (file: Buffer, strategy?: "ADD" | "SET", key?: string) =>
    this.multipart<KitchenImportResult>("kitchen/items/import", {
      file: { buffer: file, filename: "inventario.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      fields: strategy ? { strategy } : undefined,
    }, key);
  /** Descarga de la plantilla: se revisa con SheetJS, no como JSON. */
  itemImportTemplate = async (): Promise<{ status: number; contentType: string | undefined; buffer: Buffer }> => {
    const res = await this.ctx.get("kitchen/items/import/template");
    return {
      status: res.status(),
      contentType: res.headers()["content-type"],
      buffer: Buffer.from(await res.body()),
    };
  };

  get = <T>(path: string) => this.send<T>("get", path);
  post = <T>(path: string, data?: unknown, headers?: Record<string, string>) => this.send<T>("post", path, data, headers);
  patch = <T>(path: string, data?: unknown) => this.send<T>("patch", path, data);

  // catálogos
  units = () => this.get<KitchenUnitRef[]>("kitchen/units?includeInactive=true");
  createUnit = (input: { code: string; name: string; whole?: boolean }) => this.post<KitchenUnitRef>("kitchen/units", input);
  updateUnit = (id: string, input: { name?: string; whole?: boolean; active?: boolean }) => this.patch<KitchenUnitRef>(`kitchen/units/${id}`, input);
  categories = () => this.get<Array<{ id: string; name: string; active: boolean }>>("kitchen/categories?includeInactive=true");
  createCategory = (input: { name: string }) => this.post<{ id: string; name: string }>("kitchen/categories", input);
  updateCategory = (id: string, input: { name?: string; active?: boolean }) => this.patch<{ id: string }>(`kitchen/categories/${id}`, input);
  suppliers = () => this.get<Array<{ id: string; name: string; active: boolean }>>("kitchen/suppliers?includeInactive=true");
  createSupplier = (input: {
    name: string;
    email?: string | null;
    contacts?: Array<{ name: string; email?: string | null; isPrimary?: boolean; position?: string | null; phone?: string | null }>;
  }) => this.post<{ id: string; name: string }>("kitchen/suppliers", input);
  updateSupplier = (id: string, input: { name?: string; active?: boolean }) => this.patch<{ id: string }>(`kitchen/suppliers/${id}`, input);

  // tasas de IVA (catálogo fijo sembrado: iva_0 / iva_8 / iva_16)
  taxRates = () => this.get<Array<{ id: string; name: string; rate: number | string; active: boolean }>>("kitchen/tax-rates");

  // centros de costo
  costCenters = (includeInactive?: boolean) =>
    this.get<CostCenterRow[]>(`kitchen/cost-centers${includeInactive ? "?includeInactive=true" : ""}`);
  createCostCenter = (input: { name: string; code: string; departmentId?: string | null }) => this.post<CostCenterRow>("kitchen/cost-centers", input);
  updateCostCenter = (id: string, input: { name?: string; code?: string; departmentId?: string | null; active?: boolean }) =>
    this.patch<CostCenterRow>(`kitchen/cost-centers/${id}`, input);
  spending = (from?: string | null, to?: string | null) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const suffix = q.toString();
    return this.get<CostCenterSpending>(`kitchen/cost-centers/spending${suffix ? `?${suffix}` : ""}`);
  };

  // artículos / reabastecimiento
  createItem = (input: {
    code: string;
    name: string;
    categoryId: string;
    kind: "CONSUMABLE" | "DURABLE";
    unitId: string;
    storage?: "DRY" | "REFRIGERATED" | "FROZEN";
    tracksExpiry?: boolean;
    minStock?: number;
    maxStock?: number | null;
  }) => this.post<{ id: string; code: string }>("kitchen/items", input);
  item = (id: string) => this.get<KitchenItemDetail>(`kitchen/items/${id}`);
  itemsTable = (params: unknown) => this.post<{ data: KitchenItemRow[]; total: number }>("kitchen/items/table", params);
  restock = () => this.get<RestockRow[]>("kitchen/restock");
  stockIn = (input: unknown) => this.post<{ id: string }>("kitchen/movements/stock-in", input);
  stockOut = (input: unknown, key?: string) => this.post<{ id: string }>("kitchen/movements/stock-out", input, idempotency(key));
  adjust = (input: unknown, key?: string) => this.post<{ id: string }>("kitchen/movements/adjustments", input, idempotency(key));
  reverse = (id: string, key?: string) => this.post<{ id: string }>(`kitchen/movements/${id}/reverse`, {}, idempotency(key));
  movement = (id: string) =>
    this.get<{ id: string; type: string; status: string; lines: Array<{ lot: { lotCode: string }; quantity: number }> }>(`kitchen/movements/${id}`);
  fefoPreview = (input: unknown) =>
    this.post<{ today: string; lines: Array<{ itemId: string; allocations: Array<{ lotCode: string; quantity: number }>; missing: number }> }>(
      "kitchen/movements/fefo-preview",
      input
    );

  // órdenes de compra
  ordersTable = (params: unknown) => this.post<{ data: Array<{ id: string; number: string; status: string }>; total: number }>("kitchen/purchase-orders/table", params);
  createOrder = (input: unknown) => this.post<PurchaseOrderDetail>("kitchen/purchase-orders", input);
  order = (id: string) => this.get<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}`);
  updateOrder = (id: string, input: unknown) => this.patch<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}`, input);
  approveOrder = (id: string) => this.post<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}/approve`, {});
  sendOrder = (id: string) => this.post<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}/send`, {});
  /**
   * Envío multipart del PDF al proveedor. `file` ausente cubre el caso 400.
   * El cuerpo se arma a mano con su boundary y se sobreescribe el
   * `Content-Type` por petición: el contexto de la suite trae JSON por defecto
   * y eso rompería el parser de Express.
   */
  sendOrderEmail = async (
    id: string,
    form: { file?: { buffer: Buffer; filename: string; mimeType: string }; to: string; subject: string; message: string }
  ): Promise<{ status: number; body: PurchaseOrderDetail }> => {
    const boundary = `----E2EBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const chunks: Buffer[] = [];
    const field = (name: string, value: string) =>
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
    field("to", form.to);
    field("subject", form.subject);
    field("message", form.message);
    if (form.file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.file.filename}"\r\nContent-Type: ${form.file.mimeType}\r\n\r\n`,
          "utf8"
        )
      );
      chunks.push(form.file.buffer);
      chunks.push(Buffer.from("\r\n", "utf8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

    const res = await this.ctx.post(`kitchen/purchase-orders/${id}/send-email`, {
      data: Buffer.concat(chunks),
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    });
    const body = (await res.json().catch(() => null)) as PurchaseOrderDetail;
    return { status: res.status(), body };
  };
  cancelOrder = (id: string) => this.post<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}/cancel`, {});
  receiveOrder = (id: string, input: unknown, key?: string) => this.post<{ id: string }>(`kitchen/purchase-orders/${id}/receive`, input, idempotency(key));

  // facturas
  createInvoice = (input: unknown) => this.post<InvoiceDetail>("kitchen/invoices", input);
  invoice = (id: string) => this.get<InvoiceDetail>(`kitchen/invoices/${id}`);
  cancelInvoice = (id: string) => this.post<InvoiceDetail>(`kitchen/invoices/${id}/cancel`, {});
  invoicesTable = (params: unknown) => this.post<{ data: Array<{ id: string; number: string }>; total: number }>("kitchen/invoices/table", params);
}
