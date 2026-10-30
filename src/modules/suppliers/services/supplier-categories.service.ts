import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { SupplierCategoryUpdateInput, SupplierCategoriesSetInput } from "../models/dto/supplier-categories.dto";

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === "P2002";

/** Categorías del catálogo de proveedores y su asignación a cada proveedor. Borrado lógico. */
export class SupplierCategoriesService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  list(includeInactive = false) {
    return this.db.supplierCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  async create(input: { name: string; active?: boolean }) {
    try {
      return await this.db.supplierCategory.create({ data: { name: input.name, active: input.active ?? true } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "SUPPLIER_CATEGORY_NAME_TAKEN");
      throw err;
    }
  }

  async update(id: string, input: SupplierCategoryUpdateInput) {
    await this.find(id);
    try {
      return await this.db.supplierCategory.update({ where: { id }, data: input });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "SUPPLIER_CATEGORY_NAME_TAKEN");
      throw err;
    }
  }

  async remove(id: string) {
    await this.find(id);
    return this.db.supplierCategory.update({ where: { id }, data: { active: false } });
  }

  /** Reemplaza las categorías del proveedor. Todas deben existir y estar activas. */
  async setForSupplier(supplierId: string, input: SupplierCategoriesSetInput) {
    const supplier = await this.db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");

    const ids = [...new Set(input.categoryIds)];
    if (ids.length > 0) {
      const found = await this.db.supplierCategory.count({ where: { id: { in: ids }, active: true } });
      if (found !== ids.length) throw new HttpError(404, "SUPPLIER_CATEGORY_NOT_FOUND");
    }

    await this.db.$transaction(async (tx) => {
      await tx.supplierCategoryLink.deleteMany({ where: { supplierId } });
      if (ids.length > 0) {
        await tx.supplierCategoryLink.createMany({ data: ids.map((categoryId) => ({ supplierId, categoryId })) });
      }
    });
    return this.db.supplierCategoryLink.findMany({
      where: { supplierId },
      include: { category: { select: { id: true, name: true, active: true } } },
    });
  }

  private async find(id: string) {
    const category = await this.db.supplierCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "SUPPLIER_CATEGORY_NOT_FOUND");
    return category;
  }
}
