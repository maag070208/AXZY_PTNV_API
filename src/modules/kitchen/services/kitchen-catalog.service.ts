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
  TaxRateCreateInput,
  TaxRateUpdateInput,
  KitchenUnitUpdateInput,
  CostCenterCreateInput,
  CostCenterUpdateInput,
} from "../models/dto/kitchen.dto";

type Tx = Prisma.TransactionClient;
/** Sirve igual el cliente normal que una transacción (carga masiva). */
type Db = Tx | PrismaClient;

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

/** Nombre comparable: sin acentos, mayúsculas ni espacios de más. */
const normalizeName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

/**
 * Unidades que se miden en fracciones (1.5 kg, 0.25 L): el resto se maneja
 * entera (3 cajas, 2 botellas). Es una heurística para no obligar a nadie a
 * capturar `whole` en el Excel; la pantalla de catálogos lo puede corregir.
 */
const FRACTIONAL_UNIT =
  /(GRAMO|KILO|LITRO|MILILITRO|ONZA|TONELADA|LIBRA|METRO|CENTIMETRO|^G$|^KG$|^KGS$|^L$|^LT$|^LTS$|^ML$|^OZ$|^M$|^CM$)/;

/** Código de la unidad a partir de su nombre, libre de choques. */
const freeUnitCode = (name: string, taken: string[]): string => {
  const base =
    normalizeName(name)
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 10) || "UNIT";
  const used = new Set(taken.map((code) => code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 8)}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 6)}${Date.now().toString(36).toUpperCase().slice(-4)}`;
};

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

  private async categoryOrFail(id: string, db: Db = this.db) {
    const category = await db.kitchenCategory.findUnique({ where: { id } });
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

  private async unitOrFail(id: string, db: Db = this.db) {
    const unit = await db.kitchenUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "KITCHEN_UNIT_NOT_FOUND");
    return unit;
  }


  // --- tasas de IVA -----------------------------------------------------------

  listTaxRates(includeInactive: boolean) {
    return this.db.taxRate.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { rate: "asc" }],
    });
  }

  createTaxRate(input: TaxRateCreateInput) {
    return uniqueOr(() => this.db.taxRate.create({ data: { name: input.name, rate: new Prisma.Decimal(input.rate.toFixed(4)) } }), "TAX_RATE_TAKEN");
  }

  async updateTaxRate(id: string, input: TaxRateUpdateInput) {
    const current = await this.db.taxRate.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "TAX_RATE_NOT_FOUND");
    return uniqueOr(
      () =>
        this.db.taxRate.update({
          where: { id },
          data: { ...input, ...(input.rate !== undefined && { rate: new Prisma.Decimal(input.rate.toFixed(4)) }) },
        }),
      "TAX_RATE_TAKEN"
    );
  }

  /** La tasa por defecto de un artículo debe existir y estar activa. */
  private async assertTaxRate(id: string | null | undefined, db: Db = this.db) {
    if (!id) return;
    const rate = await db.taxRate.findUnique({ where: { id } });
    if (!rate) throw new HttpError(404, "TAX_RATE_NOT_FOUND");
    if (!rate.active) throw new HttpError(409, "TAX_RATE_INACTIVE");
  }

  // --- centros de costo -------------------------------------------------------

  listCostCenters(includeInactive: boolean) {
    return this.db.costCenter.findMany({
      where: includeInactive ? {} : { active: true },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }

  async createCostCenter(input: CostCenterCreateInput, actorId?: string) {
    await this.assertDepartment(input.departmentId);
    const costCenter = await uniqueOr(
      () =>
        this.db.costCenter.create({
          data: { name: input.name, code: input.code.toUpperCase(), departmentId: input.departmentId ?? null },
          include: { department: { select: { id: true, name: true } } },
        }),
      "COST_CENTER_TAKEN"
    );
    await this.audit?.({ action: "COST_CENTER_CREATED", entityType: "CostCenter", entityId: costCenter.id, userId: actorId, newState: { name: costCenter.name, code: costCenter.code } });
    return costCenter;
  }

  async updateCostCenter(id: string, input: CostCenterUpdateInput, actorId?: string) {
    const current = await this.db.costCenter.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "COST_CENTER_NOT_FOUND");
    if (input.departmentId !== undefined) await this.assertDepartment(input.departmentId);
    const costCenter = await uniqueOr(
      () =>
        this.db.costCenter.update({
          where: { id },
          data: { ...input, ...(input.code && { code: input.code.toUpperCase() }) },
          include: { department: { select: { id: true, name: true } } },
        }),
      "COST_CENTER_TAKEN"
    );
    await this.audit?.({ action: "COST_CENTER_UPDATED", entityType: "CostCenter", entityId: id, userId: actorId, previousState: { name: current.name, code: current.code, active: current.active }, newState: { name: costCenter.name, code: costCenter.code, active: costCenter.active } });
    return costCenter;
  }

  private async assertDepartment(id: string | null | undefined) {
    if (!id) return;
    const department = await this.db.department.findUnique({ where: { id } });
    if (!department) throw new HttpError(404, "DEPARTMENT_NOT_FOUND");
  }

  // --- artículos -------------------------------------------------------------

  async createItem(input: KitchenItemCreateInput, actorId?: string, db: Db = this.db) {
    assertLimits(input.minStock, input.maxStock ?? null);
    const category = await this.categoryOrFail(input.categoryId, db);
    if (!category.active) throw new HttpError(409, "KITCHEN_CATEGORY_INACTIVE");
    const unit = await this.unitOrFail(input.unitId, db);
    if (!unit.active) throw new HttpError(409, "KITCHEN_UNIT_INACTIVE");
    await this.assertTaxRate(input.defaultTaxRateId, db);
    const item = await uniqueOr(
      () =>
        db.kitchenItem.create({
          data: {
            ...input,
            code: input.code.toUpperCase(),
            minStock: dec(input.minStock),
            maxStock: input.maxStock == null ? null : dec(input.maxStock),
          },
        }),
      "KITCHEN_ITEM_CODE_TAKEN"
    );
    await this.audit?.(
      { action: "KITCHEN_ITEM_CREATED", entityType: "KitchenItem", entityId: item.id, userId: actorId, newState: { code: item.code, name: item.name } },
      db as Tx
    );
    return item;
  }

  /**
   * Garantiza la categoría por nombre (la carga masiva no exige que el archivo
   * use el catálogo: lo que traiga y no exista se crea). Compara sin acentos ni
   * mayúsculas y reutiliza la que ya existe, aunque esté inactiva — reactivarla
   * es una decisión de la pantalla de catálogos, no de una carga.
   */
  async ensureCategory(name: string, db: Db = this.db) {
    const wanted = normalizeName(name);
    const existing = (await db.kitchenCategory.findMany()).find((c) => normalizeName(c.name) === wanted);
    if (existing) return existing;
    return uniqueOr(() => db.kitchenCategory.create({ data: { name: name.trim() } }), "CATEGORY_NAME_TAKEN");
  }

  /**
   * Garantiza la unidad de medida por nombre (o por código). Una unidad nueva se
   * crea con el código derivado del nombre y `whole` según la unidad: las de
   * peso/volumen son fraccionarias (1.5 kg) y el resto enteras (3 cajas).
   */
  async ensureUnit(name: string, db: Db = this.db) {
    const wanted = normalizeName(name);
    const units = await db.kitchenUnit.findMany();
    const existing = units.find((u) => normalizeName(u.name) === wanted || normalizeName(u.code) === wanted);
    if (existing) return existing;
    const code = freeUnitCode(name, units.map((u) => u.code));
    return uniqueOr(
      () => db.kitchenUnit.create({ data: { code, name: name.trim(), whole: !FRACTIONAL_UNIT.test(wanted) } }),
      "UNIT_CODE_TAKEN"
    );
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
    if (input.defaultTaxRateId && input.defaultTaxRateId !== current.defaultTaxRateId) await this.assertTaxRate(input.defaultTaxRateId);
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
