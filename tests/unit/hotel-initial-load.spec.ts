import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";
import { HotelInitialLoadService } from "../../src/modules/hotel-store/services/initial-load.service";

const workbook = (rows: unknown[][]) => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "InitialLoad");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
};

const HEADER = ["code", "quantity", "unitCost", "location"];

const products = [
  { id: "soap", code: "SOAP", active: true, unit: { whole: true } },
  { id: "towel", code: "TOWEL", active: true, unit: { whole: true } },
  { id: "oil", code: "OIL", active: true, unit: { whole: false } },
  { id: "old", code: "OLD", active: false, unit: { whole: true } },
];

const makeDb = (warehouseExists = true, alreadyLoaded = false) => ({
  hotelWarehouse: {
    findUnique: async () => (warehouseExists ? { id: "central", active: true } : null),
  },
  hotelMovement: { findFirst: async () => (alreadyLoaded ? { id: "m0" } : null) },
  hotelProduct: { findMany: async () => products },
  hotelLocation: { findMany: async () => [{ id: "central-general", code: "GENERAL" }] },
});

const makeMovements = () => {
  const posted: Array<{ input: unknown; actor: string; key: string | null | undefined }> = [];
  return {
    posted,
    post: async (input: unknown, actor: string, key?: string | null) => {
      posted.push({ input, actor, key });
      return { id: "m1" };
    },
  };
};

const codes = (errors: Array<{ code: string }>) => errors.map((e) => e.code);

test.describe("M3 initial load preview", () => {
  test("a valid file gives lines and no errors", async () => {
    const svc = new HotelInitialLoadService(makeDb() as never, makeMovements() as never);
    const preview = await svc.preview(
      workbook([HEADER, ["SOAP", "10", "2.5", "GENERAL"], ["TOWEL", "4", "", ""]]),
      "central"
    );
    expect(preview.valid).toBe(true);
    expect(preview.rowCount).toBe(2);
    expect(preview.lines).toEqual([
      { productId: "soap", quantity: 10, unitCost: 2.5, toLocationId: "central-general" },
      { productId: "towel", quantity: 4, unitCost: null, toLocationId: null },
    ]);
  });

  test("every bad row is reported and the file is not valid", async () => {
    const svc = new HotelInitialLoadService(makeDb() as never, makeMovements() as never);
    const preview = await svc.preview(
      workbook([
        HEADER,
        ["", "1", "", ""],
        ["NOPE", "1", "", ""],
        ["OLD", "1", "", ""],
        ["SOAP", "0", "", ""],
        ["TOWEL", "1.5", "", ""],
        ["OIL", "2", "-1", ""],
        ["SOAP", "3", "", ""],
        ["TOWEL", "3", "", "NOWHERE"],
      ]),
      "central"
    );
    expect(preview.valid).toBe(false);
    expect(codes(preview.errors)).toEqual([
      "HOTEL_IMPORT_CODE_REQUIRED",
      "HOTEL_IMPORT_UNKNOWN_PRODUCT",
      "HOTEL_IMPORT_PRODUCT_INACTIVE",
      "HOTEL_IMPORT_QUANTITY_INVALID",
      "HOTEL_IMPORT_QUANTITY_NOT_WHOLE",
      "HOTEL_IMPORT_COST_INVALID",
      "HOTEL_IMPORT_DUPLICATE_PRODUCT",
      "HOTEL_IMPORT_UNKNOWN_LOCATION",
    ]);
    expect(preview.errors[0]).toMatchObject({ row: 2, field: "code" });
  });

  test("a file without rows is not valid", async () => {
    const svc = new HotelInitialLoadService(makeDb() as never, makeMovements() as never);
    expect((await svc.preview(workbook([HEADER]), "central")).valid).toBe(false);
  });

  test("a warehouse that already has an initial load is refused", async () => {
    const svc = new HotelInitialLoadService(makeDb(true, true) as never, makeMovements() as never);
    await expect(svc.preview(workbook([HEADER, ["SOAP", "1", "", ""]]), "central")).rejects.toMatchObject({
      code: "HOTEL_INITIAL_LOAD_EXISTS",
    });
  });
});

test.describe("M3 initial load confirm", () => {
  test("posts exactly one initial-load movement keyed by warehouse and file hash", async () => {
    const movements = makeMovements();
    const svc = new HotelInitialLoadService(makeDb() as never, movements as never);
    const file = workbook([HEADER, ["SOAP", "10", "2.5", ""]]);
    await svc.confirm(file, "central", "maria");
    expect(movements.posted).toHaveLength(1);
    expect(movements.posted[0].input).toMatchObject({ type: "INITIAL_LOAD", warehouseId: "central" });
    expect(movements.posted[0].key).toMatch(/^initial-load:central:[0-9a-f]{64}$/);
    expect(movements.posted[0].actor).toBe("maria");
  });

  test("an invalid file posts nothing (all or nothing)", async () => {
    const movements = makeMovements();
    const svc = new HotelInitialLoadService(makeDb() as never, movements as never);
    await expect(svc.confirm(workbook([HEADER, ["SOAP", "10", "2.5", ""], ["NOPE", "1", "", ""]]), "central", "maria")).rejects.toMatchObject({
      code: "HOTEL_INITIAL_LOAD_INVALID",
    });
    expect(movements.posted).toHaveLength(0);
  });

  test("the template has the expected headers", () => {
    const svc = new HotelInitialLoadService(makeDb() as never, makeMovements() as never);
    const sheet = XLSX.read(svc.template(), { type: "buffer" }).Sheets["InitialLoad"];
    expect(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0]).toEqual(HEADER);
  });
});
