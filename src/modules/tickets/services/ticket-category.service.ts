import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

/** Catálogo de categorías de ticket. */
export class TicketCategoryService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.ticketCategory.findMany({
      where: includeInactive ? {} : { activo: true },
      orderBy: { nombre: "asc" },
    });
  }

  async create(data: { nombre: string }) {
    const existing = await this.db.ticketCategory.findUnique({ where: { nombre: data.nombre } });
    if (existing) throw new HttpError(409, "Ya existe una categoría con ese nombre");

    return this.db.ticketCategory.create({ data: { nombre: data.nombre } });
  }

  async update(id: string, data: { nombre?: string; activo?: boolean }) {
    const category = await this.db.ticketCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "Categoría no encontrada");

    if (data.nombre) {
      const dup = await this.db.ticketCategory.findUnique({ where: { nombre: data.nombre } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe una categoría con ese nombre");
    }

    return this.db.ticketCategory.update({ where: { id }, data });
  }

  async remove(id: string) {
    const category = await this.db.ticketCategory.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "Categoría no encontrada");

    const ticketCount = await this.db.ticket.count({ where: { categoryId: id } });
    if (ticketCount > 0) {
      if (category.activo) {
        const data = await this.db.ticketCategory.update({ where: { id }, data: { activo: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, `No se puede eliminar: ${ticketCount} ticket(s) usan esta categoría`);
    }

    if (category.activo) {
      const data = await this.db.ticketCategory.update({ where: { id }, data: { activo: false } });
      return { soft: true, data };
    }

    const data = await this.db.ticketCategory.delete({ where: { id } });
    return { soft: false, data };
  }
}
