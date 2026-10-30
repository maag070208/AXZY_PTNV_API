import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { normalizeHeader, parseFirstSheet } from "@core/utils/xlsxParse";
import { assertWholeQuantity } from "./hotel-catalog-rules";
import type { HotelMovementService, MovementLineInput } from "./movement.service";

/** Column names of the import template (English, as the rest of the system). */
export const INITIAL_LOAD_COLUMNS = ["code", "quantity", "unitCost", "location"] as const;

export interface InitialLoadRowError {
  row: number;
  field: string;
  code: string;
}

export interface InitialLoadPreview {
  valid: boolean;
  rowCount: number;
  fileHash: string;
  errors: InitialLoadRowError[];
  lines: MovementLineInput[];
}

const field = (row: Record<string, unknown>, name: string): unknown => {
  const key = Object.keys(row).find((k) => normalizeHeader(k) === normalizeHeader(name));
  return key ? row[key] : undefined;
};

const isBlank = (value: unknown): boolean => value === undefined || value === null || String(value).trim() === "";

/**
 * Initial load from an Excel file (M3 3.3). Preview validates every row; confirm
 * posts exactly one INITIAL_LOAD movement, and only when the whole file is valid.
 * The request key is derived from the warehouse and the file hash, so uploading the
 * same file again returns the original movement instead of duplicating it.
 */
export class HotelInitialLoadService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService
  ) {}

  /** Blank template with the expected headers. */
  template(): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet([[...INITIAL_LOAD_COLUMNS]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "InitialLoad");
    return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  }

  async preview(buffer: Buffer, warehouseId: string): Promise<InitialLoadPreview> {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id: warehouseId }, select: { id: true, active: true } });
    if (!warehouse || !warehouse.active) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    const existing = await this.db.hotelMovement.findFirst({
      where: { type: "INITIAL_LOAD", warehouseId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, "HOTEL_INITIAL_LOAD_EXISTS");

    const rows = parseFirstSheet(buffer);
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const errors: InitialLoadRowError[] = [];
    const lines: MovementLineInput[] = [];
    const seen = new Set<string>();

    const products = await this.db.hotelProduct.findMany({
      where: { code: { in: rows.map((r) => String(field(r, "code") ?? "").trim()).filter(Boolean) } },
      include: { unit: { select: { whole: true } } },
    });
    const byCode = new Map(products.map((p) => [p.code, p]));
    const locations = await this.db.hotelLocation.findMany({
      where: { warehouseId, active: true },
      select: { id: true, code: true },
    });
    const byLocation = new Map(locations.map((l) => [l.code, l.id]));

    rows.forEach((row, index) => {
      const rowNumber = index + 2; // header is row 1
      const fail = (name: string, code: string) => errors.push({ row: rowNumber, field: name, code });

      const code = String(field(row, "code") ?? "").trim();
      if (!code) return fail("code", "HOTEL_IMPORT_CODE_REQUIRED");
      const product = byCode.get(code);
      if (!product) return fail("code", "HOTEL_IMPORT_UNKNOWN_PRODUCT");
      if (!product.active) return fail("code", "HOTEL_IMPORT_PRODUCT_INACTIVE");
      if (seen.has(code)) return fail("code", "HOTEL_IMPORT_DUPLICATE_PRODUCT");
      seen.add(code);

      const quantity = Number(field(row, "quantity"));
      if (!Number.isFinite(quantity) || quantity <= 0) return fail("quantity", "HOTEL_IMPORT_QUANTITY_INVALID");
      try {
        assertWholeQuantity(quantity, product.unit.whole);
      } catch {
        return fail("quantity", "HOTEL_IMPORT_QUANTITY_NOT_WHOLE");
      }

      let unitCost: number | null = null;
      if (!isBlank(field(row, "unitCost"))) {
        unitCost = Number(field(row, "unitCost"));
        if (!Number.isFinite(unitCost) || unitCost < 0) return fail("unitCost", "HOTEL_IMPORT_COST_INVALID");
      }

      let toLocationId: string | null = null;
      if (!isBlank(field(row, "location"))) {
        const location = String(field(row, "location")).trim();
        toLocationId = byLocation.get(location) ?? null;
        if (!toLocationId) return fail("location", "HOTEL_IMPORT_UNKNOWN_LOCATION");
      }

      lines.push({ productId: product.id, quantity, unitCost, toLocationId });
    });

    return { valid: errors.length === 0 && lines.length > 0, rowCount: rows.length, fileHash, errors, lines };
  }

  async confirm(buffer: Buffer, warehouseId: string, actorId: string) {
    const preview = await this.preview(buffer, warehouseId);
    if (!preview.valid) {
      throw new HttpError(422, "HOTEL_INITIAL_LOAD_INVALID", { errors: preview.errors });
    }
    return this.movements.post(
      { type: "INITIAL_LOAD", warehouseId, lines: preview.lines },
      actorId,
      `initial-load:${warehouseId}:${preview.fileHash}`
    );
  }
}
