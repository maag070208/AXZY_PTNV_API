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
import { personalProfileInclude } from "../models/entity/personal.entity";
import type {
  EmployeeDiscountsSetInput,
  PersonalProfileUpdateInput,
} from "../models/dto/personal.dto";

/** Roles que forman el roster de "Personal" (RH). ADMIN y RECURSOS_HUMANOS son cuentas de
 * operación/administración, no expedientes de personal. */
const PERSONAL_ROLES: Role[] = ["GERENTE", "JEFE_DE_AREA", "EMPLEADO"];

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

    const roles = { GERENTE: 0, JEFE_DE_AREA: 0, EMPLEADO: 0 } as Record<Role, number>;
    for (const row of byRole) roles[row.role] = row._count._all;

    const total = byRole.reduce((acc, row) => acc + row._count._all, 0);
    const activos = await this.db.user.count({
      where: { role: { in: PERSONAL_ROLES }, active: true },
    });

    return { total, activos, inactivos: total - activos, roles };
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
      { name: "name", numeroEmpleado: "numeroEmpleado", createdAt: "createdAt" },
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
    if (!profile) throw new HttpError(404, "Personal no encontrado");
    return profile;
  }

  async updateProfile(id: string, data: PersonalProfileUpdateInput) {
    await this.getById(id);

    if (data.generoId) {
      const genero = await this.db.genero.findUnique({ where: { id: data.generoId } });
      if (!genero) throw new HttpError(404, "Género inválido");
    }
    if (data.tipoSangreId) {
      const tipoSangre = await this.db.tipoSangre.findUnique({ where: { id: data.tipoSangreId } });
      if (!tipoSangre) throw new HttpError(404, "Tipo de sangre inválido");
    }

    await this.db.user.update({
      where: { id },
      data: {
        segundoNombre: data.segundoNombre,
        apellidoPaterno: data.apellidoPaterno,
        apellidoMaterno: data.apellidoMaterno,
        email: data.email,
        generoId: data.generoId,
        tipoSangreId: data.tipoSangreId,
        padecimiento: data.padecimiento,
        alergias: data.alergias,
        fechaNacimiento: toDateOrNull(data.fechaNacimiento),
        fechaIngreso: toDateOrNull(data.fechaIngreso),
        rfc: data.rfc,
        curp: data.curp,
        nss: data.nss,
        calleNumero: data.calleNumero,
        colonia: data.colonia,
        codigoPostal: data.codigoPostal,
        ciudad: data.ciudad,
        estadoDireccion: data.estadoDireccion,
        pais: data.pais,
        celularPersonal: data.celularPersonal,
        celularEmpresa: data.celularEmpresa,
        contactoEmergenciaNombre: data.contactoEmergenciaNombre,
        contactoEmergenciaTelefono: data.contactoEmergenciaTelefono,
        contactoEmergenciaParentesco: data.contactoEmergenciaParentesco,
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
          data: { userId: id, tipo: d.tipo, nota: d.nota },
        })
      ),
    ]);

    return this.getById(id);
  }
}
