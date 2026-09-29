import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { ErrorCode } from "@core/i18n";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  KitchenCategoryCreateInput,
  KitchenCategoryUpdateInput,
  KitchenItemCreateInput,
  KitchenItemUpdateInput,
  KitchenUnitCreateInput,
  KitchenUnitUpdateInput,
  SupplierCreateInput,
  SupplierUpdateInput,
} from "../models/dto/kitchen.dto";

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Un nombre/código repetido (índice único) es 409 con su código, no un 500. */
const uniqueOr = async <T>(fn: () => Promise<T>, code: ErrorCode): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, code);
    throw err;
  }
};

const dec = (n: number) => new Prisma.Decimal(n.toFixed(3));

/**
 * Catálogos del almacén de cocina: categorías, proveedores y artículos (con
 * sus mínimos y máximos). No se borran: se desactivan (`active`), porque los
 * lotes y el kardex los siguen referenciando.
 */
export class KitchenCatalogService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  // --- categorías ------------------------------------------------------------

  listCategories(includeInactive: boolean) {
    return this.db.kitchenCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  createCategory(input: KitchenCategoryCreateInput) {
    return uniqueOr(() => this.db.kitchenCategory.create({ data: { name: input.name } }), "CATEGORY_NAME_TAKEN");
  }

  async updateCategory(id: string, input: KitchenCategoryUpdateInput) {
    await this.categoryOrFail(id);
    return uniqueOr(() => this.db.kitchenCategory.update({ where: { id }, data: input }), "CATEGORY_NAME_TAKEN");
  }

  private async categoryOrFail(id: string) {
    const category = await this.db.kitchenCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "KITCHEN_CATEGORY_NOT_FOUND");
    return category;
  }

  // --- unidades de medida -----------------------------------------------------

  listUnits(includeInactive: boolean) {
    return this.db.kitchenUnit.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  createUnit(input: KitchenUnitCreateInput) {
    return uniqueOr(
      () => this.db.kitchenUnit.create({ data: { ...input, code: input.code.toUpperCase() } }),
      "UNIT_CODE_TAKEN"
    );
  }

  async updateUnit(id: string, input: KitchenUnitUpdateInput) {
    await this.unitOrFail(id);
    return uniqueOr(
      () =>
        this.db.kitchenUnit.update({
          where: { id },
          data: { ...input, ...(input.code && { code: input.code.toUpperCase() }) },
        }),
      "UNIT_CODE_TAKEN"
    );
  }

  private async unitOrFail(id: string) {
    const unit = await this.db.kitchenUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "KITCHEN_UNIT_NOT_FOUND");
    return unit;
  }

  // --- proveedores -----------------------------------------------------------

  listSuppliers(includeInactive: boolean) {
    return this.db.supplier.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { name: "asc" } });
  }

  createSupplier(input: SupplierCreateInput) {
    return uniqueOr(() => this.db.supplier.create({ data: input }), "SUPPLIER_NAME_TAKEN");
  }

  async updateSupplier(id: string, input: SupplierUpdateInput) {
    const supplier = await this.db.supplier.findUnique({ where: { id } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    return uniqueOr(() => this.db.supplier.update({ where: { id }, data: input }), "SUPPLIER_NAME_TAKEN");
  }

  // --- artículos -------------------------------------------------------------

  async createItem(input: KitchenItemCreateInput, actorId?: string) {
    assertLimits(input.minStock, input.maxStock ?? null);
    const category = await this.categoryOrFail(input.categoryId);
    if (!category.active) throw new HttpError(409, "KITCHEN_CATEGORY_INACTIVE");
    const unit = await this.unitOrFail(input.unitId);
    if (!unit.active) throw new HttpError(409, "KITCHEN_UNIT_INACTIVE");
    const item = await uniqueOr(
      () =>
        this.db.kitchenItem.create({
          data: {
            ...input,
            code: input.code.toUpperCase(),
            minStock: dec(input.minStock),
            maxStock: input.maxStock == null ? null : dec(input.maxStock),
          },
        }),
      "KITCHEN_ITEM_CODE_TAKEN"
    );
    await this.audit?.({ action: "KITCHEN_ITEM_CREATED", entityType: "KitchenItem", entityId: item.id, userId: actorId, newState: { code: item.code, name: item.name } });
    return item;
  }

  async updateItem(id: string, input: KitchenItemUpdateInput, actorId?: string) {
    const current = await this.db.kitchenItem.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
    const minStock = input.minStock ?? current.minStock.toNumber();
    const maxStock = input.maxStock !== undefined ? input.maxStock : current.maxStock?.toNumber() ?? null;
    assertLimits(minStock, maxStock);
    if (input.categoryId && input.categoryId !== current.categoryId) {
      const category = await this.categoryOrFail(input.categoryId);
      if (!category.active) throw new HttpError(409, "KITCHEN_CATEGORY_INACTIVE");
    }
    if (input.unitId && input.unitId !== current.unitId) {
      const unit = await this.unitOrFail(input.unitId);
      if (!unit.active) throw new HttpError(409, "KITCHEN_UNIT_INACTIVE");
    }
    // Con existencias registradas, cambiar la unidad (kg ↔ pieza) o el tipo
    // cambiaría el significado de todo el kardex anterior.
    const changesMeaning = (input.unitId && input.unitId !== current.unitId) || (input.kind && input.kind !== current.kind);
    if (changesMeaning && (await this.db.kitchenLot.count({ where: { itemId: id } })) > 0) {
      throw new HttpError(409, "KITCHEN_ITEM_UNIT_LOCKED");
    }
    const item = await uniqueOr(
      () =>
        this.db.kitchenItem.update({
          where: { id },
          data: {
            ...input,
            ...(input.code && { code: input.code.toUpperCase() }),
            ...(input.minStock !== undefined && { minStock: dec(input.minStock) }),
            ...(input.maxStock !== undefined && { maxStock: input.maxStock === null ? null : dec(input.maxStock) }),
          },
        }),
      "KITCHEN_ITEM_CODE_TAKEN"
    );
    await this.audit?.({
      action: "KITCHEN_ITEM_UPDATED",
      entityType: "KitchenItem",
      entityId: id,
      userId: actorId,
      previousState: { code: current.code, minStock: current.minStock.toNumber(), maxStock: current.maxStock?.toNumber() ?? null, active: current.active },
      newState: { code: item.code, minStock: item.minStock.toNumber(), maxStock: item.maxStock?.toNumber() ?? null, active: item.active },
    });
    return item;
  }
}

/** `maxStock ≥ minStock ≥ 0` (la base lo vuelve a validar con un CHECK). */
const assertLimits = (minStock: number, maxStock: number | null) => {
  if (minStock < 0 || (maxStock !== null && maxStock < minStock)) throw new HttpError(400, "INVALID_STOCK_LIMITS");
};
