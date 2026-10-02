import { test, expect } from "./support/fixtures";
import { KitchenApi } from "./support/kitchen-api";
import { contextAuthenticated } from "./support/fixtures";
import * as XLSX from "xlsx";
import { E2E } from "./support/env";

/**
 * CARGA MASIVA DEL INVENTARIO DE COCINA desde Excel.
 *
 * La bodega arranca vacía (6 unidades de medida, 0 categorías, 0 artículos), así
 * que la carga tiene que poder crear todo: categorías, unidades, artículos y su
 * existencia inicial como lotes. Si el artículo ya existe, el archivo se reporta
 * y el usuario decide con `strategy`: `ADD` suma y `SET` deja la cantidad exacta
 * del archivo (entrada o ajuste a la baja).
 *
 * Igual que la carga de dispositivos: previsualización que no escribe nada,
 * confirmación todo-o-nada en una transacción, e idempotencia por `Idempotency-Key`.
 */

/**
 * Todo lo que crea esta suite lleva el prefijo `E2E` (en el código del artículo,
 * en el nombre de la categoría y en el de la unidad): la limpieza del paquete
 * `api/` borra por ese prefijo, así que no queda nada en la base.
 */
const RUN = `K${Date.now().toString(36).toUpperCase()}`;
const CODE = (name: string) => `E2E-${name}-${RUN}`.toUpperCase();
const NAMED = (kind: string) => `E2E ${kind} ${RUN}`;

/** Arma un .xlsx con una sola hoja a partir de encabezados + filas. */
const workbook = (rows: unknown[][]): Buffer => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["CÓDIGO", "ARTÍCULO", "CATEGORÍA", "UNIDAD", "CANTIDAD", "CADUCIDAD", "LOTE", "COSTO", "MÍNIMO", "MÁXIMO", "TIPO", "ALMACÉN", "PERECEDERO", "IVA"],
    ...rows,
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Artículos");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

test.describe("Carga masiva del inventario de cocina", () => {
  let admin: KitchenApi;
  let employee: KitchenApi;
  let anonymous: KitchenApi;

  test.beforeEach(async ({ ctxAdmin, ctxEmployee, ctxAnonymous }) => {
    admin = new KitchenApi(ctxAdmin);
    employee = new KitchenApi(ctxEmployee);
    anonymous = new KitchenApi(ctxAnonymous);
  });

  test("crea categorías, unidades, artículos y su existencia desde cero", async () => {
    const category = NAMED("LÁCTEOS");
    const unit = NAMED("GARRAFA");
    const code = CODE("LECHE");

    const file = workbook([
      [code, "LECHE ENTERA 1 L", category, unit, 24, "2026-10-20", "", 22.5, 10, 40, "CONSUMIBLE", "REFRIGERADO", "SÍ", "16"],
      [CODE("PLATO"), "PLATO LLANO", category, "PIEZA", 120, "", "", 45, 24, 200, "DURADERO", "SECO", "NO", ""],
      ["", `E2E SERVILLETAS ${RUN}`, category, "PAQUETE", 30, "", "", 12, 10, 50, "", "", "", ""],
    ]);

    // --- Previsualización: dice lo que hará y NO escribe nada ---
    const preview = await admin.previewItemImport(file);
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ rows: 3, valid: 3, invalid: 0, itemsToCreate: 3 });
    expect(preview.body.summary.categoriesToCreate).toEqual([category]);
    expect(preview.body.summary.unitsToCreate).toEqual([unit]);
    expect(preview.body.summary.quantityIn).toBe(174);
    expect(preview.body.rows[0]).toMatchObject({
      code,
      action: "CREATE",
      delta: 24,
      expiresAt: "2026-10-20",
      categoryNew: true,
      unitNew: true,
      currentStock: null,
      errors: [],
    });
    // El renglón sin código lo deriva del nombre y lo avisa.
    expect(preview.body.rows[2].codeDerived).toBe(true);
    expect(preview.body.rows[2].code).toContain("SERVILLETAS");
    expect(preview.body.rows[2].code.startsWith("E2E")).toBe(true);
    expect(preview.body.rows[2].warnings).toContain("CODE_DERIVED");

    // Nada de eso existe todavía.
    const before = await admin.itemsTable({ page: 1, limit: 50, filters: { code } });
    expect(before.body.total).toBe(0);
    const categoriesBefore = await admin.categories();
    expect(categoriesBefore.body.some((c) => c.name === category)).toBe(false);

    // --- Confirmación: todo en una transacción ---
    const result = await admin.importItems(file);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      itemsCreated: 3,
      categoriesCreated: 1,
      unitsCreated: 1,
      lotsCreated: 3,
      quantityIn: 174,
      repeated: false,
    });
    expect(result.body.movementId).toBeTruthy();

    // Artículos con su existencia, unidad, categoría y caducidad.
    const items = await admin.itemsTable({ page: 1, limit: 50, filters: { code } });
    expect(items.body.total).toBe(1);
    const item = items.body.data[0];
    expect(item.available).toBe(24);

    const detail = await admin.item(item.id);
    expect(detail.body.available).toBe(24);
    expect(detail.body.lots).toHaveLength(1);
    expect(detail.body.lots[0].onHand).toBe(24);
    expect(detail.body.stockValue).toBeCloseTo(24 * 22.5, 2);

    // El kardex queda con la entrada, no con un saldo suelto.
    const movement = await admin.movement(result.body.movementId!);
    expect(movement.body.type).toBe("STOCK_IN");
    expect(movement.body.lines).toHaveLength(3);

    // El artículo duradero entró sin caducidad; el de "PIEZA" no la pedía.
    const plate = await admin.itemsTable({ page: 1, limit: 10, filters: { code: CODE("PLATO") } });
    expect(plate.body.data[0].available).toBe(120);
  });

  test("un artículo existente se reporta: SUMAR agrega y PONER deja la cantidad exacta", async () => {
    const category = NAMED("CARNES");
    const code = CODE("POLLO");
    await admin.importItems(workbook([[code, "PECHUGA DE POLLO", category, "KILOGRAMO", 10, "2026-11-01", "", 90, 5, 30, "CONSUMIBLE", "CONGELADO", "SÍ", "0"]]));

    const items = await admin.itemsTable({ page: 1, limit: 10, filters: { code } });
    const itemId = items.body.data[0].id;
    expect(items.body.data[0].available).toBe(10);

    // SUMAR: 4 más → 14.
    const addFile = workbook([[code, "PECHUGA DE POLLO", category, "KILOGRAMO", 4, "2026-11-10", "LOTE-B", 95, 5, 30, "CONSUMIBLE", "CONGELADO", "SÍ", "0"]]);
    const addPreview = await admin.previewItemImport(addFile, "ADD");
    expect(addPreview.body.rows[0]).toMatchObject({ action: "ADD", delta: 4, currentStock: 10, resultingStock: 14 });
    expect(addPreview.body.summary.existingItems).toBe(1);
    expect(addPreview.body.summary.itemsToCreate).toBe(0);

    const added = await admin.importItems(addFile, "ADD");
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ itemsCreated: 0, itemsReused: 1, quantityIn: 4, quantityOut: 0 });
    expect((await admin.item(itemId)).body.available).toBe(14);

    // PONER ESA (a la baja): 6 → sale 8 por FEFO.
    const setFile = workbook([[code, "PECHUGA DE POLLO", category, "KILOGRAMO", 6, "", "", 95, 5, 30, "CONSUMIBLE", "CONGELADO", "NO", "0"]]);
    const setPreview = await admin.previewItemImport(setFile, "SET");
    expect(setPreview.body.rows[0]).toMatchObject({ action: "SET_DOWN", delta: -8, currentStock: 14, resultingStock: 6 });
    expect(setPreview.body.summary).toMatchObject({ adjustedOut: 1, quantityOut: 8, lots: 0 });

    const set = await admin.importItems(setFile, "SET");
    expect(set.status).toBe(201);
    expect(set.body).toMatchObject({ quantityIn: 0, quantityOut: 8, lotsCreated: 0 });
    expect((await admin.item(itemId)).body.available).toBe(6);
    const adjust = await admin.movement(set.body.movementId!);
    expect(adjust.body.type).toBe("ADJUSTMENT_OUT");
    expect(adjust.body.lines).toHaveLength(1);

    // PONER ESA (al alza): 9 → entra 3.
    const upFile = workbook([[code, "PECHUGA DE POLLO", category, "KILOGRAMO", 9, "2026-11-20", "LOTE-C", 95, 5, 30, "CONSUMIBLE", "CONGELADO", "SÍ", "0"]]);
    const up = await admin.importItems(upFile, "SET");
    expect(up.body).toMatchObject({ quantityIn: 3, quantityOut: 0, lotsCreated: 1 });
    expect((await admin.item(itemId)).body.available).toBe(9);

    // PONER ESA con la misma cantidad: no mueve nada y no crea movimiento.
    const same = await admin.importItems(upFile, "SET");
    expect(same.status).toBe(201);
    expect(same.body).toMatchObject({ quantityIn: 0, quantityOut: 0, lotsCreated: 0, movementId: null });
    expect((await admin.item(itemId)).body.available).toBe(9);
  });

  test("un archivo con errores no crea NADA", async () => {
    const category = NAMED("ERRORES");

    // Sin nombre, perecedero sin caducidad, cantidad inválida y tipo desconocido.
    const file = workbook([
      [CODE("SINNOMBRE"), "", category, "KILOGRAMO", 5, "2026-10-01", "", 10, 0, 0, "", "", "", ""],
      [CODE("SINCADUCIDAD"), "QUESO", category, "KILOGRAMO", 5, "", "", 10, 0, 0, "CONSUMIBLE", "REFRIGERADO", "SÍ", ""],
      [CODE("CANTIDAD"), "CREMA", category, "LITRO", "mucho", "", "", 10, 0, 0, "", "", "", ""],
      [CODE("TIPO"), "SARTÉN", category, "PIEZA", 5, "", "", 10, 0, 0, "COMESTIBLE", "", "NO", ""],
    ]);

    const preview = await admin.previewItemImport(file);
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ rows: 4, valid: 0, invalid: 4 });
    expect(preview.body.rows.map((row) => row.errors)).toEqual([
      ["MISSING_NAME"],
      ["EXPIRY_REQUIRED"],
      ["INVALID_QUANTITY"],
      ["INVALID_KIND"],
    ]);

    // Confirmar un archivo con errores es 400 y no deja nada a medias.
    const confirmed = await admin.importItems(file);
    expect(confirmed.status).toBe(400);
    expect(confirmed.body).toMatchObject({ code: "KITCHEN_IMPORT_HAS_ERRORS" });

    const categories = await admin.categories();
    expect(categories.body.some((c) => c.name === category)).toBe(false);
    const items = await admin.itemsTable({ page: 1, limit: 50, filters: { code: CODE("CANTIDAD") } });
    expect(items.body.total).toBe(0);
  });

  test("la misma petición repetida no carga dos veces", async () => {
    const code = CODE("ARROZ");
    const file = workbook([[code, "ARROZ 1 KG", NAMED("ABARROTES"), "KILOGRAMO", 20, "2027-01-15", "", 28, 5, 40, "CONSUMIBLE", "SECO", "SÍ", "0"]]);
    const key = `e2e-kitchen-import-${RUN}`;

    const first = await admin.importItems(file, "ADD", key);
    expect(first.status).toBe(201);
    expect(first.body.repeated).toBe(false);

    const again = await admin.importItems(file, "ADD", key);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ repeated: true, movementId: first.body.movementId, quantityIn: 20 });

    const items = await admin.itemsTable({ page: 1, limit: 10, filters: { code } });
    expect(items.body.data[0].available).toBe(20);
  });

  test("permisos: sin token 401, sin permiso 403, y la confirmación exige también dar entrada", async ({ ctxAdmin }) => {
    const file = workbook([[CODE("PERMISO"), "SALSA", NAMED("PERMISOS"), "LITRO", 3, "2026-12-01", "", 15, 0, 0, "CONSUMIBLE", "SECO", "SÍ", ""]]);

    expect((await anonymous.previewItemImport(file)).status).toBe(401);
    expect((await anonymous.importItems(file)).status).toBe(401);
    expect((await employee.previewItemImport(file)).status).toBe(403);
    expect((await employee.importItems(file)).status).toBe(403);

    // Con SOLO `kitchen.manage` (excepción temporal) la previsualización pasa
    // —no escribe— pero la confirmación sigue prohibida: dar entrada es otro
    // permiso. La excepción se quita siempre al terminar.
    const users = await ctxAdmin.get("users?limit=200");
    const body = (await users.json()) as { data?: Array<{ id: string; username: string }> } | Array<{ id: string; username: string }>;
    const list = Array.isArray(body) ? body : (body.data ?? []);
    const target = list.find((u) => u.username === E2E.employee.username);
    expect(target, "el usuario de pruebas debe existir").toBeDefined();

    const granted = await ctxAdmin.put(`users/${target!.id}/permissions/kitchen.manage`, {
      data: { scope: "ALL", reason: "E2E: carga masiva de cocina" },
    });
    expect(granted.status()).toBe(200);
    try {
      const employeeManage = await new KitchenApi(await contextAuthenticated(E2E.employee.username));
      expect((await employeeManage.previewItemImport(file)).status).toBe(200);
      const denied = await employeeManage.importItems(file);
      expect(denied.status).toBe(403);
    } finally {
      const removed = await ctxAdmin.delete(`users/${target!.id}/permissions/kitchen.manage`);
      expect(removed.status()).toBe(200);
    }

    // Y con la excepción fuera, vuelve a estar prohibido.
    const back = await new KitchenApi(await contextAuthenticated(E2E.employee.username));
    expect((await back.previewItemImport(file)).status).toBe(403);
  });

  test("la plantilla trae los encabezados y los catálogos", async () => {
    const template = await admin.itemImportTemplate();
    expect(template.status).toBe(200);
    expect(template.contentType).toContain("spreadsheetml.sheet");
    expect(template.buffer.length).toBeGreaterThan(0);

    const book = XLSX.read(template.buffer, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Artículos", "Catálogos"]);
    const headers = XLSX.utils.sheet_to_json<string[]>(book.Sheets["Artículos"], { header: 1 })[0];
    expect(headers).toEqual([
      "CÓDIGO", "ARTÍCULO", "CATEGORÍA", "UNIDAD", "CANTIDAD", "CADUCIDAD", "LOTE",
      "COSTO", "MÍNIMO", "MÁXIMO", "TIPO", "ALMACÉN", "PERECEDERO", "IVA",
    ]);
    // Las unidades sembradas aparecen en la hoja de catálogos.
    const catalog = XLSX.utils.sheet_to_json<string[]>(book.Sheets["Catálogos"], { header: 1, blankrows: false });
    expect(JSON.stringify(catalog)).toContain("Pieza");
  });
});
