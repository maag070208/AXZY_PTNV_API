import { test, expect } from "./support/fixtures";
import { clearKitchenE2E } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";
import { KitchenApi, type KitchenUnitRef, type PurchaseOrderDetail } from "./support/kitchen-api";

/**
 * E2E de contrato — Almacén de cocina: órdenes de compra (F3) y facturas (F4).
 *
 * Todo se crea con el prefijo `E2E` en códigos/nombres y se borra al terminar,
 * así los datos reales del cliente nunca se tocan. La recepción de una orden
 * genera el mismo `STOCK_IN` de v1 y la factura actualiza el costo de los lotes.
 */
assertSafeDatabase();

const RUN = newRunId();
const today = new Date().toISOString().slice(0, 10);
let sequence = 0;
const nextCode = (): string => `${E2E_PREFIX}-${RUN}-${String(++sequence).padStart(3, "0")}`;

test.describe("Almacén de cocina — compras", () => {
  let admin: KitchenApi;
  let manager: KitchenApi;
  let employee: KitchenApi;
  let anonymous: KitchenApi;
  let unit: KitchenUnitRef;
  let categoryId: string;
  let supplierId: string;

  test.beforeAll(async ({ ctxAdmin, ctxManager, ctxEmployee, ctxAnonymous }) => {
    admin = new KitchenApi(ctxAdmin);
    manager = new KitchenApi(ctxManager);
    employee = new KitchenApi(ctxEmployee);
    anonymous = new KitchenApi(ctxAnonymous);

    const created = await admin.createUnit({ code: `${E2E_PREFIX}U${RUN.slice(-6)}`, name: `Unidad E2E ${RUN}` });
    expect(created.status).toBe(201);
    unit = created.body;

    const category = await admin.createCategory({ name: `${E2E_PREFIX} Cat ${RUN}` });
    const supplier = await admin.createSupplier({ name: `${E2E_PREFIX} Prov ${RUN}` });
    expect(category.status).toBe(201);
    expect(supplier.status).toBe(201);
    categoryId = category.body.id;
    supplierId = supplier.body.id;
  });

  test.afterAll(async () => {
    await clearKitchenE2E();
  });

  /** Crea un artículo de cocina propio del test (código único `E2E`). */
  const createItem = async (opts: { tracksExpiry?: boolean; minStock?: number; maxStock?: number | null } = {}) => {
    const code = nextCode();
    const res = await admin.createItem({
      code,
      name: `Insumo ${code}`,
      categoryId,
      kind: "CONSUMABLE",
      unitId: unit.id,
      tracksExpiry: opts.tracksExpiry ?? false,
      minStock: opts.minStock ?? 0,
      maxStock: opts.maxStock ?? null,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  /** Crea una OC en borrador con un renglón y la deja aprobada + enviada. */
  const approvedOrder = async (itemId: string, quantity: number, unitCost: number | null = null): Promise<PurchaseOrderDetail> => {
    const created = await admin.createOrder({
      supplierId,
      lines: [{ itemId, quantity, ...(unitCost == null ? {} : { unitCost }) }],
    });
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^OC-\d{4}-\d{4,}$/);
    expect(created.body.status).toBe("DRAFT");

    expect((await manager.approveOrder(created.body.id)).status).toBe(200);
    const sent = await admin.sendOrder(created.body.id);
    expect(sent.status).toBe(200);
    return sent.body;
  };

  test("401 sin token y 403 para quien no tiene el permiso", async () => {
    expect((await anonymous.ordersTable({ page: 1, limit: 10, filters: {} })).status).toBe(401);

    const itemId = await createItem();
    const forbidden = await employee.createOrder({ supplierId, lines: [{ itemId, quantity: 1 }] });
    expect(forbidden.status).toBe(403);
    expect((await employee.ordersTable({ page: 1, limit: 10, filters: {} })).status).toBe(403);
    expect((await employee.approveOrder("00000000-0000-0000-0000-000000000000")).status).toBe(403);
  });

  test("crear una OC a mano y editarla en borrador", async () => {
    const itemId = await createItem();
    const created = await admin.createOrder({
      supplierId,
      expectedAt: today,
      notes: "OC de prueba",
      lines: [{ itemId, quantity: 30, unitCost: 100 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.lines[0].pendingQuantity).toBe(30);

    const updated = await admin.updateOrder(created.body.id, { lines: [{ itemId, quantity: 40, unitCost: 105 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.lines[0].quantity).toBe(40);
  });

  test("aprobar (gerencia) / enviar y no editar fuera de borrador", async () => {
    const itemId = await createItem();
    const created = await admin.createOrder({ supplierId, lines: [{ itemId, quantity: 5 }] });
    const id = created.body.id;

    expect((await manager.approveOrder(id)).body.status).toBe("APPROVED");
    expect((await admin.updateOrder(id, { notes: "tarde" })).status).toBe(409);
    expect((await manager.approveOrder(id)).status).toBe(409);
    expect((await admin.sendOrder(id)).body.status).toBe("SENT");
  });

  test("recepción parcial: crea lote, sube el disponible y es idempotente", async () => {
    const itemId = await createItem({ tracksExpiry: true });
    const order = await approvedOrder(itemId, 10, 100);
    const lineId = order.lines[0].id;

    // Perecedero sin caducidad → no se puede recibir.
    const noExpiry = await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 4 }] });
    expect(noExpiry.status).toBe(400);

    const receive = await admin.receiveOrder(order.id, {
      lines: [{ lineId, quantity: 4, lotCode: `${E2E_PREFIX}-LOT-${RUN}`, expiresAt: "2027-01-01" }],
    });
    expect(receive.status).toBe(201);

    const partial = await admin.order(order.id);
    expect(partial.body.status).toBe("PARTIALLY_RECEIVED");
    expect(partial.body.lines[0].receivedQuantity).toBe(4);
    expect(partial.body.lines[0].pendingQuantity).toBe(6);

    const detail = await admin.item(itemId);
    expect(detail.body.available).toBe(4);
    expect(detail.body.lots.some((l) => l.onHand === 4)).toBe(true);

    // Misma Idempotency-Key → no vuelve a contar.
    const key = `${E2E_PREFIX}-${RUN}-IDEM`;
    const first = await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 6, expiresAt: "2027-02-01" }] }, key);
    const again = await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 6, expiresAt: "2027-02-01" }] }, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await admin.order(order.id)).body.status).toBe("RECEIVED");

    // Ya recibida: no se puede cancelar ni recibir de más.
    expect((await admin.cancelOrder(order.id)).status).toBe(409);
    expect((await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 1, expiresAt: "2027-03-01" }] })).status).toBe(409);
  });

  test("el reabastecimiento resta lo que está en tránsito", async () => {
    const itemId = await createItem({ minStock: 10, maxStock: 50 });

    const before = (await admin.restock()).body.find((r) => r.id === itemId);
    expect(before?.available).toBe(0);
    expect(before?.inTransit).toBe(0);
    expect(before?.suggested).toBe(50);

    await approvedOrder(itemId, 30);

    const after = (await admin.restock()).body.find((r) => r.id === itemId);
    expect(after?.inTransit).toBe(30);
    expect(after?.suggested).toBe(20);
  });

  test("factura ligada a la OC actualiza el costo del lote y muestra el cotejo", async () => {
    const itemId = await createItem({ tracksExpiry: true });
    const order = await approvedOrder(itemId, 10, 100);
    const lineId = order.lines[0].id;
    await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 10, lotCode: `${E2E_PREFIX}-INV-${RUN}`, expiresAt: "2027-06-01" }] });

    const invoiceNumber = `${E2E_PREFIX}-F-${RUN}`;
    const invoice = await admin.createInvoice({
      supplierId,
      purchaseOrderId: order.id,
      number: invoiceNumber,
      date: today,
      total: 1200,
      lines: [{ itemId, purchaseOrderLineId: lineId, quantity: 10, unitCost: 120 }],
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.status).toBe("ACTIVE");

    const detail = await admin.invoice(invoice.body.id);
    expect(detail.body.lines[0]).toMatchObject({ ordered: 10, received: 10, invoicedQuantity: 10, priceDiff: 20 });

    // El costo facturado actualiza los lotes recibidos y el valor del inventario.
    const itemDetail = await admin.item(itemId);
    expect(itemDetail.body.lots.every((l) => l.unitCost === 120)).toBe(true);
    expect(itemDetail.body.stockValue).toBe(1200);

    // Folio repetido para el mismo proveedor → 409.
    const dup = await admin.createInvoice({
      supplierId,
      number: invoiceNumber,
      date: today,
      total: 1,
      lines: [{ itemId, quantity: 1, unitCost: 1 }],
    });
    expect(dup.status).toBe(409);

    // Cancelar la factura y el 403 de quien no puede registrar.
    expect((await employee.createInvoice({ supplierId, number: nextCode(), date: today, total: 1, lines: [{ itemId, quantity: 1, unitCost: 1 }] })).status).toBe(403);
    expect((await admin.cancelInvoice(invoice.body.id)).body.status).toBe("CANCELLED");
  });
});
