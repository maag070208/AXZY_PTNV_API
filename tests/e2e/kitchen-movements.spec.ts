import { test, expect } from "./support/fixtures";
import { clearKitchenE2E } from "./support/db";
import { E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";
import { KitchenApi, type KitchenUnitRef } from "./support/kitchen-api";

/**
 * E2E de contrato — movimientos del almacén de cocina: consumo FEFO, merma,
 * caducados, duraderos, conteo (ajuste), reversión y catálogos (unidades,
 * categorías, proveedores). Todo con prefijo `E2E` y limpieza al terminar.
 */
assertSafeDatabase();

const RUN = newRunId();
let sequence = 0;
const code = (): string => `${E2E_PREFIX}-${RUN}-${String(++sequence).padStart(3, "0")}`;
const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

test.describe("Almacén de cocina — movimientos", () => {
  let admin: KitchenApi;
  let employee: KitchenApi;
  let anonymous: KitchenApi;
  let unit: KitchenUnitRef;
  let categoryId: string;
  let supplierId: string;

  test.beforeAll(async ({ ctxAdmin, ctxEmployee, ctxAnonymous }) => {
    admin = new KitchenApi(ctxAdmin);
    employee = new KitchenApi(ctxEmployee);
    anonymous = new KitchenApi(ctxAnonymous);

    const created = await admin.createUnit({ code: `${E2E_PREFIX}M${RUN.slice(-6)}`, name: `Unidad mov E2E ${RUN}` });
    expect(created.status).toBe(201);
    unit = created.body;

    const category = await admin.createCategory({ name: `${E2E_PREFIX} Mov ${RUN}` });
    const supplier = await admin.createSupplier({ name: `${E2E_PREFIX} Mov Prov ${RUN}` });
    categoryId = category.body.id;
    supplierId = supplier.body.id;
  });

  test.afterAll(async () => {
    await clearKitchenE2E();
  });

  const createItem = async (opts: { kind?: "CONSUMABLE" | "DURABLE"; tracksExpiry?: boolean } = {}) => {
    const itemCode = code();
    const res = await admin.createItem({
      code: itemCode,
      name: `Insumo ${itemCode}`,
      categoryId,
      kind: opts.kind ?? "CONSUMABLE",
      unitId: unit.id,
      tracksExpiry: opts.tracksExpiry ?? true,
      minStock: 0,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  const stockIn = async (itemId: string, lines: Array<{ quantity: number; lotCode?: string; expiresAt?: string }>) => {
    const res = await admin.stockIn({
      supplierId,
      lines: lines.map((l) => ({ itemId, quantity: l.quantity, ...(l.lotCode ? { lotCode: l.lotCode } : {}), expiresAt: l.expiresAt ?? null })),
    });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  test("consumo reparte por FEFO (primero en caducar)", async () => {
    const itemId = await createItem();
    await stockIn(itemId, [
      { quantity: 5, lotCode: `${E2E_PREFIX}-EARLY-${RUN}`, expiresAt: day(60) },
      { quantity: 5, lotCode: `${E2E_PREFIX}-LATE-${RUN}`, expiresAt: day(180) },
    ]);

    const preview = await admin.fefoPreview({ type: "CONSUMPTION", lines: [{ itemId, quantity: 7 }] });
    expect(preview.status).toBe(200);
    const alloc = preview.body.lines[0];
    expect(alloc.missing).toBe(0);
    expect(alloc.allocations.map((a) => [a.lotCode, a.quantity])).toEqual([
      [`${E2E_PREFIX}-EARLY-${RUN}`, 5],
      [`${E2E_PREFIX}-LATE-${RUN}`, 2],
    ]);

    const out = await admin.stockOut({ type: "CONSUMPTION", lines: [{ itemId, quantity: 7 }] });
    expect(out.status).toBe(201);

    const movement = await admin.movement(out.body.id);
    const perLot = movement.body.lines.map((l) => [l.lot.lotCode, l.quantity]).sort();
    expect(perLot).toEqual([
      [`${E2E_PREFIX}-EARLY-${RUN}`, 5],
      [`${E2E_PREFIX}-LATE-${RUN}`, 2],
    ]);

    const detail = await admin.item(itemId);
    expect(detail.body.available).toBe(3);
  });

  test("no se consume lo caducado (sí sale como merma)", async () => {
    const itemId = await createItem();
    await stockIn(itemId, [{ quantity: 5, lotCode: `${E2E_PREFIX}-EXP-${RUN}`, expiresAt: day(-3) }]);
    const lotId = (await admin.item(itemId)).body.lots[0].id;

    // Un consumo nunca toma el lote caducado.
    const preview = await admin.fefoPreview({ type: "CONSUMPTION", lines: [{ itemId, quantity: 1 }] });
    expect(preview.body.lines[0].allocations).toHaveLength(0);
    expect(preview.body.lines[0].missing).toBe(1);
    expect((await admin.stockOut({ type: "CONSUMPTION", lines: [{ itemId, quantity: 1 }] })).status).toBe(409);
    expect((await admin.stockOut({ type: "CONSUMPTION", lines: [{ itemId, quantity: 1, lotId }] })).status).toBe(409);

    // La merma exige motivo y sí puede sacar el caducado.
    expect((await admin.stockOut({ type: "WASTE", lines: [{ itemId, quantity: 5 }] })).status).toBe(400);
    const waste = await admin.stockOut({ type: "WASTE", wasteReason: "EXPIRED", lines: [{ itemId, quantity: 5 }] });
    expect(waste.status).toBe(201);
    expect((await admin.item(itemId)).body.available).toBe(0);
  });

  test("los duraderos no se consumen (solo merman)", async () => {
    const itemId = await createItem({ kind: "DURABLE", tracksExpiry: false });
    await stockIn(itemId, [{ quantity: 10 }]);

    expect((await admin.stockOut({ type: "CONSUMPTION", lines: [{ itemId, quantity: 1 }] })).status).toBe(400);
    const waste = await admin.stockOut({ type: "WASTE", wasteReason: "BREAKAGE", lines: [{ itemId, quantity: 2 }] });
    expect(waste.status).toBe(201);
    expect((await admin.item(itemId)).body.available).toBe(8);
  });

  test("ajuste por conteo y reversión", async () => {
    const itemId = await createItem({ tracksExpiry: false });
    await stockIn(itemId, [{ quantity: 10 }]);
    const lotId = (await admin.item(itemId)).body.lots[0].id;

    const down = await admin.adjust({ type: "ADJUSTMENT_OUT", lines: [{ itemId, lotId, quantity: 3 }] });
    expect(down.status).toBe(201);
    expect((await admin.item(itemId)).body.available).toBe(7);
    expect((await admin.adjust({ type: "ADJUSTMENT_IN", lines: [{ itemId, lotId, quantity: 1 }] })).status).toBe(201);
    expect((await admin.item(itemId)).body.available).toBe(8);

    const reversal = await admin.reverse(down.body.id);
    expect(reversal.status).toBe(201);
    expect((await admin.movement(down.body.id)).body.status).toBe("CANCELLED");
    expect((await admin.item(itemId)).body.available).toBe(11);

    // Revertir dos veces / revertir una reversión no se puede.
    expect((await admin.reverse(down.body.id)).status).toBe(409);
    expect((await admin.reverse(reversal.body.id)).status).toBe(409);
  });

  test("permisos de movimientos: 401 sin token, 403 sin permiso", async () => {
    const itemId = await createItem({ tracksExpiry: false });
    const line = [{ itemId, quantity: 1 }];
    expect((await anonymous.stockIn({ lines: line })).status).toBe(401);
    expect((await employee.stockIn({ lines: line })).status).toBe(403);
    expect((await employee.stockOut({ type: "CONSUMPTION", lines: line })).status).toBe(403);
    expect((await employee.fefoPreview({ type: "CONSUMPTION", lines: line })).status).toBe(403);
    expect((await employee.adjust({ type: "ADJUSTMENT_IN", lines: [{ itemId, lotId: itemId, quantity: 1 }] })).status).toBe(403);
  });

  test("catálogos: unidades, categorías y proveedores (CRUD y duplicados)", async () => {
    const unitCode = `${E2E_PREFIX}C${RUN.slice(-5)}`;
    const createdUnit = await admin.createUnit({ code: unitCode, name: "Caja E2E", whole: true });
    expect(createdUnit.status).toBe(201);
    expect(createdUnit.body.whole).toBe(true);
    expect((await admin.createUnit({ code: unitCode, name: "Repetida" })).status).toBe(409);
    expect((await admin.updateUnit(createdUnit.body.id, { name: "Caja E2E 2", active: false })).status).toBe(200);
    expect((await admin.units()).body.some((u) => u.code === unitCode && u.active === false)).toBe(true);

    const categoryName = `${E2E_PREFIX} Cat ${code()}`;
    const createdCategory = await admin.createCategory({ name: categoryName });
    expect(createdCategory.status).toBe(201);
    expect((await admin.createCategory({ name: categoryName })).status).toBe(409);
    expect((await admin.updateCategory(createdCategory.body.id, { active: false })).status).toBe(200);

    const supplierName = `${E2E_PREFIX} Prov ${code()}`;
    const createdSupplier = await admin.createSupplier({ name: supplierName });
    expect(createdSupplier.status).toBe(201);
    expect((await admin.createSupplier({ name: supplierName })).status).toBe(409);
    expect((await admin.updateSupplier(createdSupplier.body.id, { active: false })).status).toBe(200);

    // Un EMPLEADO no administra catálogos.
    expect((await employee.createUnit({ code: `${E2E_PREFIX}X${RUN.slice(-4)}`, name: "No" })).status).toBe(403);
    expect((await employee.createCategory({ name: `${E2E_PREFIX} No` })).status).toBe(403);
  });
});
