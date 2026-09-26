import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedQuery } from "@core/db/table";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { personalProfileInclude } from "../models/entity/hr.entity";
import type {
  EmployeeDiscountsSetInput,
  PersonalProfileUpdateInput,
} from "../models/dto/hr.dto";

/** Roles que forman el roster de "Personal" (RH). ADMIN y RECURSOS_HUMANOS son cuentas de
 * operación/administración, no expedientes de personal. */
const PERSONAL_ROLES: Role[] = ["MANAGER", "AREA_HEAD", "EMPLOYEE"];

const toDateOrNull = (value: string | null | undefined): Date | null | undefined => {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
};

export class EmployeeProfileService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async stats() {
    const byRole = await this.db.user.groupBy({
      by: ["role"],
      _count: { _all: true },
      where: { role: { in: PERSONAL_ROLES } },
    });

    const roles = { MANAGER: 0, AREA_HEAD: 0, EMPLOYEE: 0 } as Record<Role, number>;
    for (const row of byRole) roles[row.role] = row._count._all;

    const total = byRole.reduce((acc, row) => acc + row._count._all, 0);
    const active = await this.db.user.count({
      where: { role: { in: PERSONAL_ROLES }, active: true },
    });

    return { total, active, inactive: total - active, roles };
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const requestedRole = filters.role ? (String(filters.role) as Role) : undefined;
    const where: Prisma.UserWhereInput = {
      role: requestedRole && PERSONAL_ROLES.includes(requestedRole)
        ? requestedRole
        : { in: PERSONAL_ROLES },
    };
    if (filters.name) where.name = ci(String(filters.name));
    if (filters.departmentId) where.departmentId = String(filters.departmentId);
    // `filters.active` puede llegar como boolean (web) o string "true"/"false"
    // (app KMP serializa Map<String,String>): Boolean("false") sería truthy.
    if (filters.active !== undefined) {
      where.active = filters.active === true || String(filters.active) === "true";
    }

    const orderBy = orderByOf(
      params.sort,
      { name: "name", employeeNumber: "employeeNumber", createdAt: "createdAt" },
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
