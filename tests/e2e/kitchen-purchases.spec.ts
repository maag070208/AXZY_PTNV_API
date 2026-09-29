import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { clearKitchenE2E, db } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";
import { KitchenApi, type KitchenUnitRef, type PurchaseOrderDetail } from "./support/kitchen-api";

/**
 * E2E de contrato — Fase 1 de compras de cocina (NEXT_STEPS_PLAN):
 *  1.1 envío de la OC por correo (gate de correo, cola y bitácora),
 *  1.2 cotejo de IVA en la factura,
 *  1.3 folio por año con consecutivo atómico,
 *  1.4 centros de costo y reporte de gasto por lo RECIBIDO.
 *
 * Todo se crea con el prefijo `E2E` y se borra en `clearKitchenE2E`. Las tasas
 * de IVA son el catálogo fijo sembrado por migración (`tax_rate_iva_8/16`).
 */
assertSafeDatabase();

const RUN = newRunId();
const TAX8 = "tax_rate_iva_8";
const TAX16 = "tax_rate_iva_16";
const PDF = Buffer.from("%PDF-1.4\n% E2E purchase order\n%%EOF\n", "utf8");

let sequence = 0;
const nextCode = (): string => `${E2E_PREFIX}-${RUN}-${String(++sequence).padStart(3, "0")}`;

/** Zona horaria del sistema (`ACCESS_REPORT_TIMEZONE`, default México). */
const resolveTimezone = async (): Promise<string> => {
  const row = await db.sysConfig.findUnique({ where: { key: "ACCESS_REPORT_TIMEZONE" } });
  const tz = row?.value?.trim();
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      /* valor inválido: cae al default */
    }
  }
  return "America/Mexico_City";
};

/** Día local (`YYYY-MM-DD`) de un instante en la zona dada. */
const localDay = (date: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** Suma días a una clave de día, sin corrimientos de zona. */
const addDaysToKey = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const ERROR_CODE = (body: unknown): string | undefined => (body as { code?: string } | null)?.code;

test.describe("Almacén de cocina — compras Fase 1", () => {
  let admin: KitchenApi;
  let manager: KitchenApi;
  let employee: KitchenApi;
  let anonymous: KitchenApi;
  let unit: KitchenUnitRef;
  let categoryId: string;
  let supplierId: string;
  let supplierEmail: string;
  let adminCtx: APIRequestContext;
  let emailFlagOriginal: { value: string; description: string | null } | null = null;

  const readEmailFlag = async () => {
    const row = await db.sysConfig.findUnique({ where: { key: "ENABLE_SEND_EMAIL" } });
    return row ? { value: row.value, description: row.description } : null;
  };

  const setEmailFlag = async (value: string) => {
    const res = await adminCtx.put("sys-config/ENABLE_SEND_EMAIL", { data: { value, description: "E2E kitchen purchases" } });
    expect(res.status()).toBe(200);
  };

  test.beforeAll(async ({ ctxAdmin, ctxManager, ctxEmployee, ctxAnonymous }) => {
    adminCtx = ctxAdmin;
    admin = new KitchenApi(ctxAdmin);
    manager = new KitchenApi(ctxManager);
    employee = new KitchenApi(ctxEmployee);
    anonymous = new KitchenApi(ctxAnonymous);

    const created = await admin.createUnit({ code: `${E2E_PREFIX}C${RUN.slice(-6)}`, name: `Unidad compras E2E ${RUN}` });
    expect(created.status).toBe(201);
    unit = created.body;

    const category = await admin.createCategory({ name: `${E2E_PREFIX} Compras ${RUN}` });
    expect(category.status).toBe(201);
    categoryId = category.body.id;

    supplierEmail = `${E2E_PREFIX.toLowerCase()}-prov-${RUN}@example.com`;
    const supplier = await admin.createSupplier({
      name: `${E2E_PREFIX} Prov compras ${RUN}`,
      contacts: [{ name: `Contacto ${RUN}`, email: supplierEmail, isPrimary: true }],
    });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id;

    // El correo debe estar encendido para el caso correcto; se restaura al final.
    emailFlagOriginal = await readEmailFlag();
    await setEmailFlag("true");
  });

  test.afterAll(async () => {
    if (emailFlagOriginal) {
      await adminCtx.put("sys-config/ENABLE_SEND_EMAIL", {
        data: { value: emailFlagOriginal.value, description: emailFlagOriginal.description ?? undefined },
      });
    } else {
      await adminCtx.delete("sys-config/ENABLE_SEND_EMAIL");
    }
    await clearKitchenE2E();
  });

  /** Artículo propio del test (código único `E2E`). */
  const createItem = async (opts: { tracksExpiry?: boolean } = {}): Promise<string> => {
    const code = nextCode();
    const res = await admin.createItem({
      code,
      name: `Insumo ${code}`,
      categoryId,
      kind: "CONSUMABLE",
      unitId: unit.id,
      tracksExpiry: opts.tracksExpiry ?? false,
      minStock: 0,
      maxStock: null,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  /** Crea una OC y la deja aprobada (sin enviar). */
  const approvedOrder = async (
    itemId: string,
    lines: Array<{ quantity: number; unitCost?: number | null; taxRateId?: string | null }>,
    extra: { costCenterId?: string } = {}
  ): Promise<PurchaseOrderDetail> => {
    const created = await admin.createOrder({
      supplierId,
      ...extra,
      lines: lines.map((l) => ({ itemId, ...l })),
    });
    expect(created.status).toBe(201);
    expect((await manager.approveOrder(created.body.id)).status).toBe(200);
    const detail = await admin.order(created.body.id);
    expect(detail.body.status).toBe("APPROVED");
    return detail.body;
  };

  test("1.1 envía la OC al proveedor y la marca SENT con fila en la cola", async () => {
    const itemId = await createItem();

    // Borrador: todavía no se puede enviar.
    const draft = await admin.createOrder({ supplierId, lines: [{ itemId, quantity: 1, unitCost: 10 }] });
    expect((await admin.sendOrderEmail(draft.body.id, { file: { buffer: PDF, filename: "oc.pdf", mimeType: "application/pdf" }, to: supplierEmail, subject: "OC", message: "Va adjunta" })).status).toBe(409);

    const order = await approvedOrder(itemId, [{ quantity: 2, unitCost: 50, taxRateId: TAX16 }]);

    // Sin PDF adjunto.
    expect((await admin.sendOrderEmail(order.id, { to: supplierEmail, subject: "OC", message: "Va adjunta" })).status).toBe(400);
    // Archivo que no es PDF.
    expect((await admin.sendOrderEmail(order.id, { file: { buffer: PDF, filename: "oc.txt", mimeType: "text/plain" }, to: supplierEmail, subject: "OC", message: "Va adjunta" })).status).toBe(400);
    // Sin destinatarios.
    expect((await admin.sendOrderEmail(order.id, { file: { buffer: PDF, filename: "oc.pdf", mimeType: "application/pdf" }, to: "", subject: "OC", message: "Va adjunta" })).status).toBe(400);

    // Caso correcto.
    const sent = await admin.sendOrderEmail(order.id, {
      file: { buffer: PDF, filename: `${order.number}.pdf`, mimeType: "application/pdf" },
      to: supplierEmail,
      subject: `OC ${order.number}`,
      message: "Adjunto la orden de compra.",
    });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("SENT");
    expect(sent.body.sentAt).toBeTruthy();

    const log = await db.emailLog.findFirst({
      where: { entityType: "PurchaseOrder", entityId: order.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.to).toContain(supplierEmail);
    expect(Array.isArray(log?.attachments)).toBe(true);
    expect((log?.attachments as unknown[] | null)?.length).toBe(1);

    // Permisos: empleado no puede enviar; sin token, 401.
    expect((await employee.sendOrderEmail(order.id, { file: { buffer: PDF, filename: "oc.pdf", mimeType: "application/pdf" }, to: supplierEmail, subject: "OC", message: "x" })).status).toBe(403);
    expect((await anonymous.sendOrderEmail(order.id, { file: { buffer: PDF, filename: "oc.pdf", mimeType: "application/pdf" }, to: supplierEmail, subject: "OC", message: "x" })).status).toBe(401);
  });

  test("1.1 con el correo apagado NO marca SENT ni audita el envío", async () => {
    const itemId = await createItem();
    try {
      await setEmailFlag("false");
      const order = await approvedOrder(itemId, [{ quantity: 1, unitCost: 10 }]);
      const res = await admin.sendOrderEmail(order.id, {
        file: { buffer: PDF, filename: "oc.pdf", mimeType: "application/pdf" },
        to: supplierEmail,
        subject: "OC",
        message: "x",
      });
      expect(res.status).toBe(409);
      expect(ERROR_CODE(res.body)).toBe("PURCHASE_ORDER_EMAIL_DISABLED");

      const after = await admin.order(order.id);
      expect(after.body.status).toBe("APPROVED");
      expect(after.body.sentAt ?? null).toBeNull();
      expect(await db.emailLog.count({ where: { entityType: "PurchaseOrder", entityId: order.id } })).toBe(0);
      expect(await db.auditLog.count({ where: { entityType: "PurchaseOrder", entityId: order.id, action: "PURCHASE_ORDER_EMAILED" } })).toBe(0);
    } finally {
      await setEmailFlag("true");
    }
  });

  test("1.3 el folio lleva año y el consecutivo es atómico", async () => {
    const itemId = await createItem();
    const first = await admin.createOrder({ supplierId, lines: [{ itemId, quantity: 1, unitCost: 1 }] });
    const second = await admin.createOrder({ supplierId, lines: [{ itemId, quantity: 1, unitCost: 1 }] });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    for (const order of [first, second]) {
      expect(order.body.number).toMatch(/^OC-\d{4}-\d{4,}$/);
      expect(order.body.number.split("-")[1]).toBe(String(new Date().getFullYear()));
    }
    const seqA = Number(first.body.number.split("-")[2]);
    const seqB = Number(second.body.number.split("-")[2]);
    expect(seqB).toBe(seqA + 1);
  });

  test("1.2 coteja el IVA de la factura contra la OC sin bloquear", async () => {
    const itemId = await createItem({ tracksExpiry: true });
    const order = await approvedOrder(itemId, [{ quantity: 10, unitCost: 100, taxRateId: TAX16 }]);
    expect(order.lines[0].taxRate).toBeCloseTo(0.16);
    const lineId = order.lines[0].id;
    await admin.receiveOrder(order.id, { lines: [{ lineId, quantity: 10, lotCode: `${E2E_PREFIX}-LOT-${RUN}`, expiresAt: "2027-06-01" }] });

    // Tasa explícita distinta a la de la OC: se reporta la diferencia.
    const inv1 = await admin.createInvoice({
      supplierId,
      purchaseOrderId: order.id,
      number: `${E2E_PREFIX}-IVA1-${RUN}`,
      date: localDay(new Date(), await resolveTimezone()),
      total: 1080,
      lines: [{ itemId, purchaseOrderLineId: lineId, quantity: 10, unitCost: 100, taxRateId: TAX8 }],
    });
    expect(inv1.status).toBe(201);
    expect(inv1.body.lines[0].taxRate).toBeCloseTo(0.08);
    expect(inv1.body.lines[0].taxRateDiff).toBeCloseTo(-0.08);
    expect(inv1.body.lines[0].taxDiff).toBeCloseTo(-80);
    expect(inv1.body.taxTotals.order?.tax).toBeCloseTo(160);
    expect(inv1.body.taxTotals.taxDiff).toBeCloseTo(-80);

    // Sin tasa explícita: propone la de la OC.
    const inv2 = await admin.createInvoice({
      supplierId,
      purchaseOrderId: order.id,
      number: `${E2E_PREFIX}-IVA2-${RUN}`,
      date: localDay(new Date(), await resolveTimezone()),
      total: 232,
      lines: [{ itemId, purchaseOrderLineId: lineId, quantity: 2, unitCost: 100 }],
    });
    expect(inv2.status).toBe(201);
    expect(inv2.body.lines[0].taxRate).toBeCloseTo(0.16);
    expect(inv2.body.lines[0].taxRateDiff).toBeCloseTo(0);
    expect(inv2.body.taxTotals.taxDiff).toBeCloseTo(0);

    // Tasa inválida → 404.
    const bad = await admin.createInvoice({
      supplierId,
      number: `${E2E_PREFIX}-IVABAD-${RUN}`,
      date: localDay(new Date(), await resolveTimezone()),
      total: 1,
      lines: [{ itemId, quantity: 1, unitCost: 1, taxRateId: "00000000-0000-0000-0000-000000000000" }],
    });
    expect(bad.status).toBe(404);

    // Sin OC: no hay contra qué cotejar; no bloquea.
    const inv3 = await admin.createInvoice({
      supplierId,
      number: `${E2E_PREFIX}-IVA3-${RUN}`,
      date: localDay(new Date(), await resolveTimezone()),
      total: 116,
      lines: [{ itemId, quantity: 1, unitCost: 100, taxRateId: TAX16 }],
    });
    expect(inv3.status).toBe(201);
    expect(inv3.body.taxTotals.order).toBeNull();
    expect(inv3.body.taxTotals.taxDiff).toBeNull();
  });

  test("1.4 centros de costo: CRUD, permisos y uso en la OC", async () => {
    expect((await anonymous.costCenters()).status).toBe(401);

    const code = `${E2E_PREFIX}-CC-${RUN}`;
    const created = await admin.createCostCenter({ name: `${E2E_PREFIX} Centro ${RUN}`, code });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe(code);

    const dup = await admin.createCostCenter({ name: `${E2E_PREFIX} Centro dup ${RUN}`, code });
    expect(dup.status).toBe(409);

    const updated = await admin.updateCostCenter(created.body.id, { name: `${E2E_PREFIX} Centro editado ${RUN}` });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toContain("editado");

    // 403 sin `kitchen.manage` (alta) y sin `purchase_orders.view` (reporte).
    expect((await employee.createCostCenter({ name: `${E2E_PREFIX} No ${RUN}`, code: `${code}-NO` })).status).toBe(403);
    expect((await employee.spending()).status).toBe(403);

    const itemId = await createItem();
    const order = await admin.createOrder({
      supplierId,
      costCenterId: created.body.id,
      lines: [{ itemId, quantity: 10, unitCost: 25, taxRateId: TAX16 }],
    });
    expect(order.status).toBe(201);
    expect(order.body.costCenter?.id).toBe(created.body.id);

    await admin.approveOrder(order.body.id);
    const lineId = order.body.lines[0].id;
    // Recepción parcial: el reporte suma lo RECIBIDO (4), no lo pedido (10).
    expect((await admin.receiveOrder(order.body.id, { lines: [{ lineId, quantity: 4 }] })).status).toBe(201);
    const detail = await admin.order(order.body.id);
    expect(detail.body.costCenter?.id).toBe(created.body.id);
    expect(detail.body.costCenter?.code).toBe(code);
  });

  test("1.4 reporte de gasto: suma lo recibido y respeta el periodo local", async () => {
    const tz = await resolveTimezone();
    const today = localDay(new Date(), tz);
    const code = `${E2E_PREFIX}-CC-REP-${RUN}`;
    const center = await admin.createCostCenter({ name: `${E2E_PREFIX} Centro reporte ${RUN}`, code });
    expect(center.status).toBe(201);

    const itemId = await createItem();
    const order = await admin.createOrder({
      supplierId,
      costCenterId: center.body.id,
      lines: [{ itemId, quantity: 10, unitCost: 25, taxRateId: TAX16 }],
    });
    await admin.approveOrder(order.body.id);
    const lineId = order.body.lines[0].id;
    // Se reciben 4 de 10: el gasto es 4 × 25 = 100 + 16 de IVA, no 250.
    await admin.receiveOrder(order.body.id, { lines: [{ lineId, quantity: 4 }] });

    const report = await admin.spending(today, today);
    expect(report.status).toBe(200);
    const row = report.body.rows.find((r) => r.costCenter?.id === center.body.id);
    expect(row).toBeTruthy();
    expect(row?.orders).toBe(1);
    expect(row?.subtotal).toBeCloseTo(100);
    expect(row?.tax).toBeCloseTo(16);
    expect(row?.total).toBeCloseTo(116);

    // Fuera del periodo local: no aparece.
    const tomorrow = addDaysToKey(today, 1);
    const future = await admin.spending(tomorrow, tomorrow);
    expect(future.body.rows.some((r) => r.costCenter?.id === center.body.id)).toBe(false);

    const yesterday = addDaysToKey(today, -1);
    const past = await admin.spending(null, yesterday);
    expect(past.body.rows.some((r) => r.costCenter?.id === center.body.id)).toBe(false);

    // Filtros inválidos: rango invertido y fecha mal formada.
    expect((await admin.spending(today, yesterday)).status).toBe(400);
    expect((await admin.spending("2026-13-01", null)).status).toBe(400);
  });
});
