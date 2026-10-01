import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { staffRoleKeys } from "@core/permissions";
import { paginatedQuery } from "@core/db/table";
import {
  filterBool,
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { personalProfileInclude } from "../models/entity/hr.entity";
import type {
  EmployeeDiscountsSetInput,
  PersonalProfileUpdateInput,
} from "../models/dto/hr.dto";

/**
 * Roles que forman el roster de "Personal" (RH). ADMIN y RH son cuentas de
 * operación/administración, no expedientes de personal; el roster sale de los
 * roles marcados `staff` en `/roles`.
 */
const personalRoles = (): string[] => staffRoleKeys();

const toDateOrNull = (value: string | null | undefined): Date | null | undefined => {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
};

export class EmployeeProfileService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async stats() {
    const roles = personalRoles();
    const byRole = await this.db.user.groupBy({
      by: ["role"],
      _count: { _all: true },
      where: { role: { in: roles } },
    });

    const byRoleCount: Record<string, number> = {};
    for (const key of roles) byRoleCount[key] = 0;
    for (const row of byRole) byRoleCount[row.role] = row._count._all;

    const total = byRole.reduce((acc, row) => acc + row._count._all, 0);
    const active = await this.db.user.count({
      where: { role: { in: roles }, active: true },
    });

    return { total, active, inactive: total - active, roles: byRoleCount };
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.UserWhereInput = {
      role: filterEnum(filters, "role", personalRoles()) ?? { in: personalRoles() },
      name: filterText(filters, "name"),
      employeeNumber: filterText(filters, "employeeNumber"),
      jobTitle: filterText(filters, "jobTitle"),
      departmentId: filterId(filters, "departmentId"),
      subareaId: filterId(filters, "subareaId"),
      // La app KMP manda "true"/"false" como texto: `filterBool` acepta ambos.
      active: filterBool(filters, "active"),
    };

    const orderBy = orderByOf(
      params.sort,
      {
        name: "name",
        employeeNumber: "employeeNumber",
        role: "role",
        active: "active",
        jobTitle: "jobTitle",
        departmentId: (direction) => ({ department: { name: direction } }),
        subareaId: (direction) => ({ subarea: { name: direction } }),
        createdAt: "createdAt",
      },
      [{ name: "asc" }]
    );

    return paginatedQuery({
      model: this.db.user,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      include: personalProfileInclude as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async getById(id: string) {
    const profile = await this.db.user.findUnique({
      where: { id },
      include: personalProfileInclude,
    });
    if (!profile) throw new HttpError(404, "EMPLOYEE_PROFILE_NOT_FOUND");
    return profile;
  }

  async updateProfile(id: string, data: PersonalProfileUpdateInput) {
    await this.getById(id);

    if (data.genderId) {
      const gender = await this.db.gender.findUnique({ where: { id: data.genderId } });
      if (!gender) throw new HttpError(404, "INVALID_GENDER");
    }
    if (data.bloodTypeId) {
      const bloodType = await this.db.bloodType.findUnique({ where: { id: data.bloodTypeId } });
      if (!bloodType) throw new HttpError(404, "INVALID_BLOOD_TYPE");
    }

    await this.db.user.update({
      where: { id },
      data: {
        middleName: data.middleName,
        paternalSurname: data.paternalSurname,
        maternalSurname: data.maternalSurname,
        email: data.email,
        genderId: data.genderId,
        bloodTypeId: data.bloodTypeId,
        medicalConditions: data.medicalConditions,
        allergies: data.allergies,
        birthDate: toDateOrNull(data.birthDate),
        hireDate: toDateOrNull(data.hireDate),
        rfc: data.rfc,
        curp: data.curp,
        nss: data.nss,
        streetAddress: data.streetAddress,
        neighborhood: data.neighborhood,
        postalCode: data.postalCode,
        city: data.city,
        addressState: data.addressState,
        country: data.country,
        personalPhone: data.personalPhone,
        workPhone: data.workPhone,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        emergencyContactRelationship: data.emergencyContactRelationship,
      },
    });

    return this.getById(id);
  }

  async setDiscounts(id: string, input: EmployeeDiscountsSetInput) {
    await this.getById(id);

    await this.db.$transaction([
      this.db.employeeDiscount.deleteMany({ where: { userId: id } }),
      ...input.discounts.map((d) =>
        this.db.employeeDiscount.create({
          data: { userId: id, type: d.type, note: d.note },
        })
      ),
    ]);

    return this.getById(id);
  }
}
