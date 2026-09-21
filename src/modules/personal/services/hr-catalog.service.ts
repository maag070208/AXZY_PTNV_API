import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  GeneroCreateInput,
  GeneroUpdateInput,
  TipoSangreCreateInput,
  TipoSangreUpdateInput,
} from "../models/dto/personal.dto";

/** Catálogos de Personal: géneros y tipos de sangre. */
export class HrCatalogService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async listGeneros(includeInactive = false) {
    return this.db.genero.findMany({
      where: includeInactive ? {} : { activo: true },
      orderBy: { nombre: "asc" },
    });
  }

  async createGenero(data: GeneroCreateInput) {
    const existing = await this.db.genero.findUnique({ where: { nombre: data.nombre } });
    if (existing) throw new HttpError(409, "Ya existe un género con ese nombre");

    return this.db.genero.create({ data: { nombre: data.nombre } });
  }

  async updateGenero(id: string, data: GeneroUpdateInput) {
    const genero = await this.db.genero.findUnique({ where: { id } });
    if (!genero) throw new HttpError(404, "Género no encontrado");

    if (data.nombre) {
      const dup = await this.db.genero.findUnique({ where: { nombre: data.nombre } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un género con ese nombre");
    }

    return this.db.genero.update({ where: { id }, data });
  }

  async removeGenero(id: string) {
    const genero = await this.db.genero.findUnique({ where: { id } });
    if (!genero) throw new HttpError(404, "Género no encontrado");

    const userCount = await this.db.user.count({ where: { generoId: id } });
    if (userCount > 0) {
      if (genero.activo) {
        const data = await this.db.genero.update({ where: { id }, data: { activo: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, `No se puede eliminar: ${userCount} empleado(s) usan este género`);
    }

    if (genero.activo) {
      const data = await this.db.genero.update({ where: { id }, data: { activo: false } });
      return { soft: true, data };
    }

    const data = await this.db.genero.delete({ where: { id } });
    return { soft: false, data };
  }

  async listTiposSangre(includeInactive = false) {
    return this.db.tipoSangre.findMany({
      where: includeInactive ? {} : { activo: true },
      orderBy: { nombre: "asc" },
    });
  }

  async createTipoSangre(data: TipoSangreCreateInput) {
    const existing = await this.db.tipoSangre.findUnique({ where: { nombre: data.nombre } });
    if (existing) throw new HttpError(409, "Ya existe un tipo de sangre con ese nombre");

    return this.db.tipoSangre.create({ data: { nombre: data.nombre } });
  }

  async updateTipoSangre(id: string, data: TipoSangreUpdateInput) {
    const tipo = await this.db.tipoSangre.findUnique({ where: { id } });
    if (!tipo) throw new HttpError(404, "Tipo de sangre no encontrado");

    if (data.nombre) {
      const dup = await this.db.tipoSangre.findUnique({ where: { nombre: data.nombre } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un tipo de sangre con ese nombre");
    }

    return this.db.tipoSangre.update({ where: { id }, data });
  }

  async removeTipoSangre(id: string) {
    const tipo = await this.db.tipoSangre.findUnique({ where: { id } });
    if (!tipo) throw new HttpError(404, "Tipo de sangre no encontrado");

    const userCount = await this.db.user.count({ where: { tipoSangreId: id } });
    if (userCount > 0) {
      if (tipo.activo) {
        const data = await this.db.tipoSangre.update({ where: { id }, data: { activo: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, `No se puede eliminar: ${userCount} empleado(s) usan este tipo de sangre`);
    }

    if (tipo.activo) {
      const data = await this.db.tipoSangre.update({ where: { id }, data: { activo: false } });
      return { soft: true, data };
    }

    const data = await this.db.tipoSangre.delete({ where: { id } });
    return { soft: false, data };
  }
}