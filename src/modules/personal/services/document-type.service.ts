import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  TipoDocumentoCreateInput,
  TipoDocumentoUpdateInput,
} from "../models/dto/personal.dto";

export class DocumentTypeService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.tipoDocumento.findMany({
      where: includeInactive ? {} : { activo: true },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    });
  }

  async create(data: TipoDocumentoCreateInput) {
    const existing = await this.db.tipoDocumento.findUnique({ where: { nombre: data.nombre } });
    if (existing) throw new HttpError(409, "Ya existe un tipo de documento con ese nombre");

    return this.db.tipoDocumento.create({
      data: { nombre: data.nombre, orden: data.orden ?? 0 },
    });
  }

  async update(id: string, data: TipoDocumentoUpdateInput) {
    const tipo = await this.db.tipoDocumento.findUnique({ where: { id } });
    if (!tipo) throw new HttpError(404, "Tipo de documento no encontrado");

    if (data.nombre) {
      const dup = await this.db.tipoDocumento.findUnique({ where: { nombre: data.nombre } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un tipo de documento con ese nombre");
    }

    return this.db.tipoDocumento.update({ where: { id }, data });
  }

  async remove(id: string) {
    const tipo = await this.db.tipoDocumento.findUnique({ where: { id } });
    if (!tipo) throw new HttpError(404, "Tipo de documento no encontrado");

    const docCount = await this.db.employeeDocument.count({ where: { tipoDocumentoId: id } });
    if (docCount > 0) {
      if (tipo.activo) {
        const data = await this.db.tipoDocumento.update({ where: { id }, data: { activo: false } });
        return { soft: true, data };
      }
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${docCount} documento(s) subido(s) con este tipo`
      );
    }

    // Sin documentos ligados: primera baja es soft, la segunda es física.
    if (tipo.activo) {
      const data = await this.db.tipoDocumento.update({ where: { id }, data: { activo: false } });
      return { soft: true, data };
    }

    const data = await this.db.tipoDocumento.delete({ where: { id } });
    return { soft: false, data };
  }
}
