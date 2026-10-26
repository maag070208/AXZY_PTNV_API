import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  assertKittable,
  assertStockThresholds,
  assertWholeQuantity,
  normalizeEveryNDays,
  type HotelKitFrequency,
  type HotelProductKind,
} from "./hotel-catalog-rules";
import type {
  HotelKitLinesInput,
  HotelKitUpdateInput,
  HotelProductCategoryUpdateInput,
  HotelProductCreateInput,
  HotelProductUpdateInput,
  HotelUnitUpdateInput,
} from "../models/dto/catalog.dto";

type UniqueField = "HOTEL_UNIT_NAME_TAKEN" | "HOTEL_CATEGORY_NAME_TAKEN" | "HOTEL_PRODUCT_CODE_TAKEN" | "HOTEL_KIT_NAME_TAKEN";

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === "P2002";

/** Convierte un P2002 de Prisma en 409 con el código de la unicidad violada. */
const uniqueOr = async <T>(code: UniqueField, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, code);
    throw err;
  }
};

/**
 * Catálogo del almacén (M2): unidades, categorías, productos y kits con sus
 * líneas. El borrado es lógico: nada se borra físicamente. Los permisos los
 * decide la ruta (`hotel_store.manage` para productos, `hotel_rooms.manage` para kits).
 */
export class HotelCatalogService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  // ── Unidades ───────────────────────────────────────────────────────────────

  units(includeInactive = false) {
    return this.db.hotelUnit.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  createUnit(input: { name: string; whole?: boolean; active?: boolean }) {
    return uniqueOr("HOTEL_UNIT_NAME_TAKEN", () =>
      this.db.hotelUnit.create({ data: { name: input.name, whole: input.whole ?? true, active: input.active ?? true } })
    );
  }

  async updateUnit(id: string, input: HotelUnitUpdateInput) {
    const unit = await this.db.hotelUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "HOTEL_UNIT_NOT_FOUND");
    if (input.whole === true && !unit.whole) {
      await this.assertKitQuantitiesWhole(id);
    }
    return uniqueOr("HOTEL_UNIT_NAME_TAKEN", () => this.db.hotelUnit.update({ where: { id }, data: input }));
  }

  /** Una unidad pasa a entera: las líneas de kit de sus productos deben ser enteras. */
  private async assertKitQuantitiesWhole(unitId: string): Promise<void> {
    const lines = await this.db.hotelKitLine.findMany({
      where: { product: { unitId } },
      select: { quantity: true },
    });
    for (const line of lines) assertWholeQuantity(Number(line.quantity), true);
  }

  async removeUnit(id: string) {
    await this.findUnit(id);
    return this.db.hotelUnit.update({ where: { id }, data: { active: false } });
  }

  private async findUnit(id: string) {
    const unit = await this.db.hotelUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "HOTEL_UNIT_NOT_FOUND");
    return unit;
  }

  // ── Categorías de producto ─────────────────────────────────────────────────

  categories(includeInactive = false) {
    return this.db.hotelProductCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  createCategory(input: { name: string; active?: boolean }) {
    return uniqueOr("HOTEL_CATEGORY_NAME_TAKEN", () =>
      this.db.hotelProductCategory.create({ data: { name: input.name, active: input.active ?? true } })
    );
  }

  async updateCategory(id: string, input: HotelProductCategoryUpdateInput) {
    await this.findCategory(id);
    return uniqueOr("HOTEL_CATEGORY_NAME_TAKEN", () =>
      this.db.hotelProductCategory.update({ where: { id }, data: input })
    );
  }

  async removeCategory(id: string) {
    await this.findCategory(id);
    return this.db.hotelProductCategory.update({ where: { id }, data: { active: false } });
  }

  private async findCategory(id: string) {
    const category = await this.db.hotelProductCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "HOTEL_CATEGORY_NOT_FOUND");
    return category;
  }

  // ── Productos ──────────────────────────────────────────────────────────────

  products(filters: { includeInactive?: boolean; kind?: HotelProductKind; categoryId?: string } = {}) {
    return this.db.hotelProduct.findMany({
      where: {
        ...(filters.includeInactive ? {} : { active: true }),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      },
      include: { unit: { select: { id: true, name: true, whole: true } }, category: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }

  async createProduct(input: HotelProductCreateInput) {
    const unit = await this.db.hotelUnit.findUnique({ where: { id: input.unitId } });
    if (!unit || !unit.active) throw new HttpError(404, "HOTEL_UNIT_NOT_FOUND");
    if (input.categoryId) await this.findCategory(input.categoryId);
    const thresholds = {
      minStock: input.minStock ?? 0,
      idealStock: input.idealStock ?? 0,
      overstock: input.overstock ?? 0,
    };
    assertStockThresholds(thresholds);

    return uniqueOr("HOTEL_PRODUCT_CODE_TAKEN", () =>
      this.db.hotelProduct.create({
        data: {
          code: input.code,
          name: input.name,
          categoryId: input.categoryId ?? null,
          unitId: input.unitId,
          kind: input.kind ?? "CONSUMIBLE",
          ...thresholds,
          active: input.active ?? true,
        },
      })
    );
  }

  async updateProduct(id: string, input: HotelProductUpdateInput) {
    const product = await this.db.hotelProduct.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");

    const merged = {
      minStock: Number(input.minStock ?? product.minStock),
      idealStock: Number(input.idealStock ?? product.idealStock),
      overstock: Number(input.overstock ?? product.overstock),
    };
    assertStockThresholds(merged);

    // Pasar a EQUIPO no se puede si el producto ya está en algún kit.
    if (input.kind === "EQUIPO" && product.kind !== "EQUIPO" && (await this.isInKit(id))) {
      throw new HttpError(409, "HOTEL_PRODUCT_NOT_KITABLE");
    }

    if (input.unitId && input.unitId !== product.unitId) {
      const unit = await this.db.hotelUnit.findUnique({ where: { id: input.unitId } });
      if (!unit || !unit.active) throw new HttpError(404, "HOTEL_UNIT_NOT_FOUND");
      if (unit.whole) await this.assertKitQuantitiesOfProduct(id);
    }
    if (input.categoryId) await this.findCategory(input.categoryId);

    return uniqueOr("HOTEL_PRODUCT_CODE_TAKEN", () =>
      this.db.hotelProduct.update({ where: { id }, data: input })
    );
  }

  /** Producto dado de baja: sigue en el historial, pero no puede estar en un kit activo. */
  async removeProduct(id: string) {
    const product = await this.db.hotelProduct.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    if (await this.isInKit(id, { activeOnly: true })) throw new HttpError(409, "HOTEL_PRODUCT_IN_KIT");
    return this.db.hotelProduct.update({ where: { id }, data: { active: false } });
  }

  private async isInKit(productId: string, opts: { activeOnly?: boolean } = {}): Promise<boolean> {
    const count = await this.db.hotelKitLine.count({
      where: { productId, ...(opts.activeOnly ? { kit: { active: true } } : {}) },
    });
    return count > 0;
  }

  private async assertKitQuantitiesOfProduct(productId: string): Promise<void> {
    const lines = await this.db.hotelKitLine.findMany({ where: { productId }, select: { quantity: true } });
    for (const line of lines) assertWholeQuantity(Number(line.quantity), true);
  }

  // ── Kits ───────────────────────────────────────────────────────────────────

  kits(includeInactive = false) {
    return this.db.hotelKit.findMany({
      where: includeInactive ? {} : { active: true },
      include: { _count: { select: { lines: true } } },
      orderBy: { name: "asc" },
    });
  }

  createKit(input: { name: string; description?: string | null; active?: boolean }) {
    return uniqueOr("HOTEL_KIT_NAME_TAKEN", () =>
      this.db.hotelKit.create({
        data: { name: input.name, description: input.description ?? null, active: input.active ?? true },
      })
    );
  }

  async updateKit(id: string, input: HotelKitUpdateInput) {
    await this.findKit(id);
    if (input.active === false) await this.assertKitNotInUse(id);
    return uniqueOr("HOTEL_KIT_NAME_TAKEN", () => this.db.hotelKit.update({ where: { id }, data: input }));
  }

  async removeKit(id: string) {
    await this.findKit(id);
    await this.assertKitNotInUse(id);
    return this.db.hotelKit.update({ where: { id }, data: { active: false } });
  }

  /** Un kit no se desactiva mientras un tipo activo lo use (409 con la lista de tipos). */
  private async assertKitNotInUse(kitId: string): Promise<void> {
    const types = await this.db.hotelRoomType.findMany({
      where: { kitId, active: true },
      select: { id: true, name: true },
    });
    if (types.length > 0) {
      throw new HttpError(409, "HOTEL_KIT_IN_USE", { types: types.map((t) => t.name) });
    }
  }

  private async findKit(id: string) {
    const kit = await this.db.hotelKit.findUnique({ where: { id } });
    if (!kit) throw new HttpError(404, "HOTEL_KIT_NOT_FOUND");
    return kit;
  }

  kitLines(kitId: string) {
    return this.db.hotelKitLine.findMany({
      where: { kitId },
      include: { product: { select: { id: true, code: true, name: true, kind: true, unit: { select: { name: true, whole: true } } } } },
      orderBy: { product: { name: "asc" } },
    });
  }

  /** Reemplaza las líneas del kit, validando cada una antes de escribir nada. */
  async setKitLines(kitId: string, input: HotelKitLinesInput) {
    await this.findKit(kitId);

    const seen = new Set<string>();
    const rows: Array<{ productId: string; quantity: number; frequency: HotelKitFrequency; everyNDays: number | null }> = [];
    for (const line of input.lines) {
      if (seen.has(line.productId)) throw new HttpError(422, "HOTEL_KIT_LINE_DUPLICATE");
      seen.add(line.productId);

      const product = await this.db.hotelProduct.findUnique({
        where: { id: line.productId },
        include: { unit: { select: { whole: true } } },
      });
      if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
      if (!product.active) throw new HttpError(409, "HOTEL_PRODUCT_INACTIVE");
      assertKittable(product.kind as HotelProductKind);
      assertWholeQuantity(line.quantity, product.unit.whole);

      const frequency = (line.frequency ?? "CADA_LIMPIEZA") as HotelKitFrequency;
      rows.push({
        productId: line.productId,
        quantity: line.quantity,
        frequency,
        everyNDays: normalizeEveryNDays(frequency, line.everyNDays ?? null),
      });
    }

    await this.db.$transaction(async (tx) => {
      await tx.hotelKitLine.deleteMany({ where: { kitId } });
      if (rows.length > 0) await tx.hotelKitLine.createMany({ data: rows.map((row) => ({ ...row, kitId })) });
    });
    return this.kitLines(kitId);
  }
}
