import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type {
  GenderCreateInput,
  GenderUpdateInput,
  BloodTypeCreateInput,
  BloodTypeUpdateInput,
} from "../models/dto/hr.dto";

/** Catálogos de Personal: géneros y tipos de sangre. */
export class HrCatalogService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async listGenders(includeInactive = false) {
    return this.db.gender.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  async createGender(data: GenderCreateInput) {
    const existing = await this.db.gender.findUnique({ where: { name: data.name } });
    if (existing) throw new HttpError(409, "Ya existe un género con ese nombre");

    return this.db.gender.create({ data: { name: data.name } });
  }

  async updateGender(id: string, data: GenderUpdateInput) {
    const gender = await this.db.gender.findUnique({ where: { id } });
    if (!gender) throw new HttpError(404, "Género no encontrado");

    if (data.name) {
      const dup = await this.db.gender.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un género con ese nombre");
    }

    return this.db.gender.update({ where: { id }, data });
  }

  async removeGender(id: string) {
    const gender = await this.db.gender.findUnique({ where: { id } });
    if (!gender) throw new HttpError(404, "Género no encontrado");

    const userCount = await this.db.user.count({ where: { genderId: id } });
    if (userCount > 0) {
      if (gender.active) {
        const data = await this.db.gender.update({ where: { id }, data: { active: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, `No se puede eliminar: ${userCount} empleado(s) usan este género`);
    }

    if (gender.active) {
      const data = await this.db.gender.update({ where: { id }, data: { active: false } });
      return { soft: true, data };
    }

    const data = await this.db.gender.delete({ where: { id } });
    return { soft: false, data };
  }

  async listBloodTypes(includeInactive = false) {
    return this.db.bloodType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
  }

  async createBloodType(data: BloodTypeCreateInput) {
    const existing = await this.db.bloodType.findUnique({ where: { name: data.name } });
    if (existing) throw new HttpError(409, "Ya existe un tipo de sangre con ese nombre");

    return this.db.bloodType.create({ data: { name: data.name } });
  }

  async updateBloodType(id: string, data: BloodTypeUpdateInput) {
    const type = await this.db.bloodType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "Tipo de sangre no encontrado");

    if (data.name) {
      const dup = await this.db.bloodType.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un tipo de sangre con ese nombre");
    }

    return this.db.bloodType.update({ where: { id }, data });
  }

  async removeBloodType(id: string) {
    const type = await this.db.bloodType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "Tipo de sangre no encontrado");

    const userCount = await this.db.user.count({ where: { bloodTypeId: id } });
    if (userCount > 0) {
      if (type.active) {
        const data = await this.db.bloodType.update({ where: { id }, data: { active: false } });
        return { soft: true, data };
      }
      throw new HttpError(400, `No se puede eliminar: ${userCount} empleado(s) usan este tipo de sangre`);
    }

    if (type.active) {
      const data = await this.db.bloodType.update({ where: { id }, data: { active: false } });
      return { soft: true, data };
    }

    const data = await this.db.bloodType.delete({ where: { id } });
    return { soft: false, data };
  }
}