import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

/** Catálogo de categorías de ticket. */
export class TicketCategoryService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.ticketCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  async create(data: { name: string }) {
    const existing = await this.db.ticketCategory.findUnique({ where: { name: data.name } });
    if (existing) throw new HttpError(409, "CATEGORY_NAME_TAKEN");

    return this.db.ticketCategory.create({ data: { name: data.name } });
  }

  async update(id: string, data: { name?: string; active?: boolean }) {
    const category = await this.db.ticketCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "CATEGORY_NOT_FOUND");

    if (data.name) {
      const dup = await this.db.ticketCategory.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new HttpError(409, "CATEGORY_NAME_TAKEN");
    }

    return this.db.ticketCategory.update({ where: { id }, data });
  }

  async remove(id: string) {
    const category = await this.db.ticketCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "CATEGORY_NOT_FOUND");

    const ticketCount = await this.db.ticket.count({ where: { categoryId: id } });
    if (ticketCount > 0) {
      if (category.active) {
        const data = await this.db.ticketCategory.update({ where: { id }, data: { active: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, "CATEGORY_IN_USE", { count: ticketCount });
    }

    if (category.active) {
      const data = await this.db.ticketCategory.update({ where: { id }, data: { active: false } });
      return { soft: true, data };
    }

    const data = await this.db.ticketCategory.delete({ where: { id } });
    return { soft: false, data };
  }
}
