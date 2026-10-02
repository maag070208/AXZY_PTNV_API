import { test, expect } from "./support/fixtures";
import { db, statusesInDb, clearDeviceImportE2E } from "./support/db";
import type { ImportPreview, ImportResult, UploadFile } from "./support/inventory-api";
import * as XLSX from "xlsx";

/**
 * CARGA MASIVA de dispositivos desde Excel.
 *
 * El flujo son dos pasos sobre el MISMO archivo: `/devices/import/preview` no
 * escribe nada y dice exactamente qué va a pasar; `/devices/import` lo ejecuta
 * en una sola transacción. Lo que se verifica aquí es lo que puede descuadrar el
 * inventario: que la previsualización no cree nada, que las unidades y los
 * folios sean los mismos que en el alta normal, que un archivo con errores no
 * cree NADA, que repetir la petición no duplique y que lo que no tiene tipo
 * válido caiga al tipo genérico en vez de inventar tipos.
 */

/** Marcador de los datos de esta suite (se limpia en `afterAll`). */
const MARKER = `E2EIMPORT${Date.now().toString(36).toUpperCase()}`;

/** Libro de Excel en memoria a partir de filas (la primera es el encabezado). */
const xlsx = (rows: (string | number)[][]): UploadFile => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Dispositivos");
  return {
    name: `${MARKER}.xlsx`,
    buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
  };
};

const HEADER = ["TIPO", "NOMBRE", "MARCA", "MODELO", "CANTIDAD"];

const asPreview = (res: { status: number; body: unknown }): ImportPreview => {
  expect(res.status).toBe(200);
  return res.body as ImportPreview;
};

const asResult = (res: { status: number; body: unknown }, status = 201): ImportResult => {
  expect(res.status).toBe(status);
  return res.body as ImportResult;
};

test.afterAll(async () => {
  await clearDeviceImportE2E(MARKER);
});

test.describe("Carga masiva de dispositivos por Excel", () => {
  // ---------------------------------------------------------------------------
  // Paso 1: previsualización
  // ---------------------------------------------------------------------------
  test("la previsualización no crea nada y anticipa el resultado", async ({ inv, scenario }) => {
    const file = xlsx([
      HEADER,
      [scenario.type.code, `${MARKER} Laptop`, "Dell", "Latitude 5540", 3],
    ]);

    const preview = asPreview(await inv.previewDeviceImport(file));

    expect(preview.summary).toMatchObject({
      rows: 1,
      valid: 1,
      invalid: 0,
      units: 3,
      newDevices: 1,
      existingDevices: 0,
    });
    expect(preview.rows[0]).toMatchObject({
      row: 2,
      action: "CREATE",
      typeUnknown: false,
      typeMissing: false,
      resolvedTypeCode: scenario.type.code,
      quantity: 3,
      errors: [],
    });
    // El rango de folios que va a consumir sale del contador del tipo.
    expect(preview.rows[0].assetTagFrom).toBe(`${scenario.type.assetTagPrefix}-0001`);
    expect(preview.rows[0].assetTagTo).toBe(`${scenario.type.assetTagPrefix}-0003`);

    // Nada se escribió: ni dispositivo, ni unidades, ni movimiento.
    expect(await db.device.count({ where: { name: `${MARKER} Laptop` } })).toBe(0);
    const type = await inv.type(scenario.type.id);
    expect(type.counter).toBe(0);
  });

  test("rechaza el archivo si no hay filas de dispositivos", async ({ inv }) => {
    const res = await inv.previewDeviceImport(xlsx([HEADER]));
    expect(res.status).toBe(200);
    expect((res.body as ImportPreview).summary.valid).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Paso 2: confirmación
  // ---------------------------------------------------------------------------
  test("da de alta el dispositivo con sus unidades y un solo movimiento de entrada", async ({
    inv,
    scenario,
  }) => {
    const file = xlsx([
      HEADER,
      [scenario.type.name, `${MARKER} Monitor`, "Dell", "P2419H", 4],
    ]);

    const result = asResult(await inv.importDevices(file));
    expect(result).toMatchObject({ devicesCreated: 1, devicesReused: 0, unitsCreated: 4, repeated: false });
    expect(result.fileName).toBe(`${MARKER}.xlsx`);

    const device = await db.device.findFirst({
      where: { name: `${MARKER} Monitor` },
      include: { type: true, units: { orderBy: { assetTag: "asc" } } },
    });
    if (!device) throw new Error("El dispositivo no se creó");
    expect(device.typeId).toBe(scenario.type.id);
    expect(device.brand).toBe("Dell");
    expect(device.model).toBe("P2419H");
    expect(device.units.map((u) => u.assetTag)).toEqual([
      `${scenario.type.assetTagPrefix}-0001`,
      `${scenario.type.assetTagPrefix}-0002`,
      `${scenario.type.assetTagPrefix}-0003`,
      `${scenario.type.assetTagPrefix}-0004`,
    ]);

    // Las existencias disponibles y el kardex quedan cuadrados con las unidades.
    const stock = await inv.stock(device.id);
    expect(stock).toMatchObject({ AVAILABLE: 4, active: 4, historical: 4 });
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 4 });
    const ledger = await inv.stockLedger(device.id);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ type: "STOCK_IN", stockIn: 4, balance: 4 });

    // UN movimiento para toda la carga, con el archivo en la razón social.
    const movements = await inv.listMovements({ deviceId: device.id });
    expect(movements).toHaveLength(1);
    expect(movements[0].id).toBe(result.movementId);
    expect(movements[0].type).toBe("STOCK_IN");
    expect(movements[0].reason).toContain(`${MARKER}.xlsx`);
    expect(movements[0].items).toHaveLength(1);
    expect((movements[0].items[0] as { units: unknown[] }).units).toHaveLength(4);

    // El contador del tipo siguió la serie.
    expect((await inv.type(scenario.type.id)).counter).toBe(4);
  });

  test("el mismo tipo escrito sin acentos ni mayúsculas cae en el tipo del catálogo", async ({
    inv,
  }) => {
    // Tipo propio con acentos en el nombre: el Excel lo escribe "a la ligera".
    const accented = await inv.createType({
      code: `${MARKER}ACC`,
      name: `Tipo ÓRIGEN ${MARKER}`,
      assetTagPrefix: `${MARKER}ACC`,
    });

    const preview = asPreview(
      await inv.previewDeviceImport(
        xlsx([
          HEADER,
          [`  tipo origen ${MARKER.toLowerCase()}  `, `${MARKER} Sloppy`, "HP", "X1", 1],
        ])
      )
    );

    expect(preview.rows[0].typeUnknown).toBe(false);
    expect(preview.rows[0].resolvedTypeCode).toBe(accented.code);
  });

  // ---------------------------------------------------------------------------
  // Tipo desconocido / ausente → genérico
  // ---------------------------------------------------------------------------
  test("una fila con tipo inexistente cae al tipo genérico y se avisa", async ({ inv }) => {
    const file = xlsx([HEADER, ["TIPO QUE NO EXISTE XYZ", `${MARKER} Raro`, "Marca", "Modelo", 2]]);

    const preview = asPreview(await inv.previewDeviceImport(file));
    expect(preview.rows[0].typeUnknown).toBe(true);
    expect(preview.rows[0].resolvedTypeCode).toBe("GENERICO");
    expect(preview.summary).toMatchObject({ genericRows: 1, unknownTypeRows: 1 });

    const generic = await db.deviceType.findUnique({ where: { code: "GENERICO" } });
    if (!generic) throw new Error("El tipo genérico no está sembrado");

    const result = asResult(await inv.importDevices(file));
    expect(result.unitsCreated).toBe(2);

    const device = await db.device.findFirst({ where: { name: `${MARKER} Raro` } });
    expect(device?.typeId).toBe(generic.id);

    // No se inventó un tipo nuevo: el catálogo sigue teniendo un solo genérico.
    expect(await db.deviceType.count({ where: { code: "TIPO QUE NO EXISTE XYZ" } })).toBe(0);
  });

  test("una fila sin tipo también cae al genérico", async ({ inv }) => {
    const preview = asPreview(
      await inv.previewDeviceImport(xlsx([HEADER, ["", `${MARKER} Sin Tipo`, "Gen", "G1", 1]]))
    );

    expect(preview.rows[0]).toMatchObject({
      typeMissing: true,
      typeUnknown: false,
      resolvedTypeCode: "GENERICO",
    });
  });

  // ---------------------------------------------------------------------------
  // Dispositivo existente: suma unidades (no lo duplica)
  // ---------------------------------------------------------------------------
  test("si el dispositivo ya existe le suma unidades en vez de duplicarlo", async ({
    inv,
    scenario,
  }) => {
    const existing = await scenario.device(3, { name: `${MARKER} Existente`, brand: "Lenovo", model: "T14" });

    const file = xlsx([
      HEADER,
      [scenario.type.code, `${MARKER} Existente`, "Lenovo", "T14", 5],
    ]);

    const preview = asPreview(await inv.previewDeviceImport(file));
    expect(preview.rows[0]).toMatchObject({ action: "ADD_UNITS", currentUnits: 3, quantity: 5 });
    expect(preview.summary).toMatchObject({ newDevices: 0, existingDevices: 1 });

    const result = asResult(await inv.importDevices(file));
    expect(result).toMatchObject({ devicesCreated: 0, devicesReused: 1, unitsCreated: 5 });

    // Un solo dispositivo con las 8 unidades y el kardex con los dos renglones.
    expect(await db.device.count({ where: { name: `${MARKER} Existente` } })).toBe(1);
    expect(await inv.stock(existing.id)).toMatchObject({ AVAILABLE: 8 });
    const ledger = await inv.stockLedger(existing.id);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows[1]).toMatchObject({ type: "STOCK_IN", stockIn: 5 });
  });

  test("dos filas del mismo archivo con el mismo dispositivo suman en una sola alta", async ({
    inv,
    scenario,
  }) => {
    const file = xlsx([
      HEADER,
      [scenario.type.code, `${MARKER} Repetido`, "Dell", "R1", 2],
      [scenario.type.code, `${MARKER} Repetido`, "Dell", "R1", 3],
    ]);

    const preview = asPreview(await inv.previewDeviceImport(file));
    // El segundo renglón avisa que se agrupa con el primero.
    expect(preview.rows[1].mergedRows).toEqual([2]);
    expect(preview.summary).toMatchObject({ units: 5, newDevices: 1 });

    const result = asResult(await inv.importDevices(file));
    expect(result).toMatchObject({ devicesCreated: 1, unitsCreated: 5 });

    const devices = await db.device.findMany({ where: { name: `${MARKER} Repetido` } });
    expect(devices).toHaveLength(1);
    expect(await statusesInDb(devices[0].id)).toEqual({ AVAILABLE: 5 });
  });

  // ---------------------------------------------------------------------------
  // Archivo con errores: no se crea NADA
  // ---------------------------------------------------------------------------
  test("un archivo con filas inválidas no crea absolutamente nada", async ({ inv, scenario }) => {
    const file = xlsx([
      HEADER,
      [scenario.type.code, `${MARKER} Buena`, "Dell", "B1", 2],
      [scenario.type.code, "", "Dell", "B2", 2],
      [scenario.type.code, `${MARKER} Cantidad Cero`, "Dell", "B3", 0],
      [scenario.type.code, `${MARKER} No Numérica`, "Dell", "B4", "muchas"],
    ]);

    const preview = asPreview(await inv.previewDeviceImport(file));
    expect(preview.summary).toMatchObject({ rows: 4, valid: 1, invalid: 3 });
    expect(preview.rows[1].errors).toContain("MISSING_NAME");
    expect(preview.rows[2].errors).toContain("INVALID_QUANTITY");
    expect(preview.rows[3].errors).toContain("INVALID_QUANTITY");

    // La confirmación del mismo archivo se rechaza y no escribe ni la fila buena.
    const res = await inv.importDevices(file);
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("DEVICE_IMPORT_HAS_ERRORS");
    expect(await db.device.count({ where: { name: { startsWith: `${MARKER} B` } } })).toBe(0);
    expect((await inv.type(scenario.type.id)).counter).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Idempotencia: la misma petición no duplica unidades
  // ---------------------------------------------------------------------------
  test("repetir la misma petición no vuelve a dar de alta las unidades", async ({ inv, scenario }) => {
    const file = xlsx([HEADER, [scenario.type.code, `${MARKER} Idempotente`, "Dell", "I1", 3]]);
    const key = `e2e-import-${MARKER}`;

    const first = asResult(await inv.importDevices(file, key));
    expect(first).toMatchObject({ repeated: false, unitsCreated: 3 });

    const second = await inv.importDevices(file, key);
    const repeated = asResult(second, 200);
    expect(repeated).toMatchObject({ repeated: true, movementId: first.movementId, unitsCreated: 3 });

    // Sigue habiendo UN dispositivo con TRES unidades y UN movimiento.
    const devices = await db.device.findMany({ where: { name: `${MARKER} Idempotente` } });
    expect(devices).toHaveLength(1);
    expect(await statusesInDb(devices[0].id)).toEqual({ AVAILABLE: 3 });
    expect(await inv.listMovements({ deviceId: devices[0].id })).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Marca y modelo vacíos: entran con valor por defecto y se avisan
  // ---------------------------------------------------------------------------
  test("marca y modelo vacíos entran con valor por defecto y quedan marcados", async ({ inv, scenario }) => {
    const preview = asPreview(
      await inv.previewDeviceImport(xlsx([HEADER, [scenario.type.code, `${MARKER} Pelado`, "", "", 1]]))
    );

    expect(preview.rows[0].warnings).toEqual(["MISSING_BRAND", "MISSING_MODEL"]);
    expect(preview.rows[0].errors).toEqual([]);

    asResult(await inv.importDevices(xlsx([HEADER, [scenario.type.code, `${MARKER} Pelado`, "", "", 1]])));
    const device = await db.device.findFirst({ where: { name: `${MARKER} Pelado` } });
    expect(device).toMatchObject({ brand: "SIN MARCA", model: "SIN MODELO" });
  });

  // ---------------------------------------------------------------------------
  // Plantilla
  // ---------------------------------------------------------------------------
  test("la plantilla se descarga en xlsx con los encabezados y el catálogo de tipos", async ({ inv }) => {
    const template = await inv.deviceImportTemplate();
    expect(template.status).toBe(200);
    expect(template.contentType).toContain("spreadsheetml.sheet");

    const book = XLSX.read(template.buffer, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Dispositivos", "Tipos"]);

    const devices = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Dispositivos, {
      header: 1,
      blankrows: false,
    });
    expect(devices[0]).toEqual(["TIPO", "NOMBRE", "MARCA", "MODELO", "CANTIDAD"]);

    const catalog = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Tipos, { header: 1 });
    const codes = catalog.slice(1).map((row) => row[0]);
    expect(codes).toContain("GENERICO");
  });

  // ---------------------------------------------------------------------------
  // Permisos
  // ---------------------------------------------------------------------------
  test("un empleado no puede previsualizar ni cargar", async ({ invEmployee }) => {
    const file = xlsx([HEADER, ["", `${MARKER} Prohibido`, "X", "Y", 1]]);
    expect((await invEmployee.previewDeviceImport(file)).status).toBe(403);
    expect((await invEmployee.importDevices(file)).status).toBe(403);
  });

  test("sin sesión no se puede previsualizar ni cargar", async ({ invAnonymous }) => {
    const file = xlsx([HEADER, ["", `${MARKER} Anónimo`, "X", "Y", 1]]);
    expect((await invAnonymous.previewDeviceImport(file)).status).toBe(401);
    expect((await invAnonymous.importDevices(file)).status).toBe(401);
  });
});
