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
}

export interface PurchaseOrderDetail {
  id: string;
  number: string;
  status: string;
  supplier: { id: string; name: string };
  lines: PurchaseOrderLine[];
  movements: Array<{ id: string }>;
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
}

export interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  total: number;
  purchaseOrder: { id: string; number: string } | null;
  lines: InvoiceLine[];
}

interface Result<T> {
  status: number;
  body: T;
}

const idempotency = (key?: string): Record<string, string> | undefined =>
  key ? { "Idempotency-Key": key } : undefined;

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
  createSupplier = (input: { name: string }) => this.post<{ id: string; name: string }>("kitchen/suppliers", input);
  updateSupplier = (id: string, input: { name?: string; active?: boolean }) => this.patch<{ id: string }>(`kitchen/suppliers/${id}`, input);

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
  cancelOrder = (id: string) => this.post<PurchaseOrderDetail>(`kitchen/purchase-orders/${id}/cancel`, {});
  receiveOrder = (id: string, input: unknown, key?: string) => this.post<{ id: string }>(`kitchen/purchase-orders/${id}/receive`, input, idempotency(key));

  // facturas
  createInvoice = (input: unknown) => this.post<InvoiceDetail>("kitchen/invoices", input);
  invoice = (id: string) => this.get<InvoiceDetail>(`kitchen/invoices/${id}`);
  cancelInvoice = (id: string) => this.post<InvoiceDetail>(`kitchen/invoices/${id}/cancel`, {});
  invoicesTable = (params: unknown) => this.post<{ data: Array<{ id: string; number: string }>; total: number }>("kitchen/invoices/table", params);
}
