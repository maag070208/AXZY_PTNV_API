import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  DocumentTypeCreateInput,
  DocumentTypeUpdateInput,
} from "../models/dto/hr.dto";

export class DocumentTypeService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(includeInactive = false) {
    return this.db.documentType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async create(data: DocumentTypeCreateInput) {
    const existing = await this.db.documentType.findUnique({ where: { name: data.name } });
    if (existing) throw new HttpError(409, "Ya existe un tipo de documento con ese nombre");

    return this.db.documentType.create({
      data: { name: data.name, sortOrder: data.sortOrder ?? 0 },
    });
  }

  async update(id: string, data: DocumentTypeUpdateInput) {
    const type = await this.db.documentType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "Tipo de documento no encontrado");

    if (data.name) {
      const dup = await this.db.documentType.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un tipo de documento con ese nombre");
    }

    return this.db.documentType.update({ where: { id }, data });
  }

  async remove(id: string) {
    const type = await this.db.documentType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "Tipo de documento no encontrado");

    const docCount = await this.db.employeeDocument.count({ where: { documentTypeId: id } });
    if (docCount > 0) {
      if (type.active) {
        const data = await this.db.documentType.update({ where: { id }, data: { active: false } });
        return { soft: true, data };
      }
      throw new HttpError(
        400,
        `No se puede eliminar: tiene ${docCount} documento(s) subido(s) con este tipo`
      );
    }

    // Sin documentos ligados: primera baja es soft, la segunda es física.
    if (type.active) {
      const data = await this.db.documentType.update({ where: { id }, data: { active: false } });
      return { soft: true, data };
    }

    const data = await this.db.documentType.delete({ where: { id } });
    return { soft: false, data };
  }
}
