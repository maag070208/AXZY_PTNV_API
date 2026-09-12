import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedQuery } from "@core/db/table";
import {
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type {
  UserCreateInput,
  UserUpdateInput,
} from "../models/dto/user.dto";

const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  active: true,
  puesto: true,
  numeroEmpleado: true,
  empresa: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  subareaId: true,
  subarea: { select: { id: true, name: true } },
  createdAt: true,
} as const;

type UserRole = UserCreateInput["role"];

export class UserService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async list(role?: UserRole) {
    return this.db.user.findMany({
      where: role ? { role } : undefined,
      select: userSelect,
      orderBy: { name: "asc" },
    });
  }

  async getById(id: string) {
    return this.db.user.findUniqueOrThrow({
      where: { id },
      select: userSelect,
    });
  }

  async table(
    params: ITDataTableFetchParams,
    callerRole?: string,
    callerDepartmentId?: string | null
  ): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.UserWhereInput = {};

    // Seguridad: un no-ADMIN solo puede consultar EMPLEADOS
    if (callerRole !== "ADMIN") {
      where.role = "EMPLEADO";
    } else if (filters.role) {
      where.role = String(filters.role) as UserRole;
    }

    // JEFE_DE_AREA solo ve empleados de su departamento
    if (callerRole === "JEFE_DE_AREA" && callerDepartmentId) {
      where.departmentId = callerDepartmentId;
    } else if (filters.department) {
      where.departmentId = String(filters.department);
    }

    const orderBy = orderByOf(
      params.sort,
      {
        username: "username",
        name: "name",
        role: "role",
        numeroEmpleado: "numeroEmpleado",
        puesto: "puesto",
        createdAt: "createdAt",
      },
      [{ name: "asc" }]
    );

    return paginatedQuery({
      model: this.db.user,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      select: userSelect as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async create(data: UserCreateInput) {
    const exists = await this.db.user.findUnique({ where: { username: data.username } });
    if (exists) throw new HttpError(409, "El username ya existe");

    if (data.numeroEmpleado) {
      const empExists = await this.db.user.findUnique({
        where: { numeroEmpleado: data.numeroEmpleado },
      });
      if (empExists) throw new HttpError(409, "Ya existe un usuario con ese número de empleado");
    }

    return this.db.user.create({
      data: {
        username: data.username,
        email: data.email,
        password: await hashPassword(data.password),
        name: data.name,
        role: data.role ?? "EMPLEADO",
        puesto: data.puesto,
        numeroEmpleado: data.numeroEmpleado,
        empresa: data.empresa,
        departmentId: data.departmentId,
        subareaId: data.subareaId,
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        active: true,
        puesto: true,
        numeroEmpleado: true,
        empresa: true,
        departmentId: true,
        subareaId: true,
      },
    });
  }

  async update(id: string, data: UserUpdateInput) {
    if (data.numeroEmpleado) {
      const dup = await this.db.user.findFirst({
        where: { numeroEmpleado: data.numeroEmpleado, NOT: { id } },
      });
      if (dup) throw new HttpError(409, "Número de empleado duplicado");
    }
    return this.db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        active: true,
        puesto: true,
        numeroEmpleado: true,
        empresa: true,
        departmentId: true,
        subareaId: true,
      },
    });
  }

  async changePassword(id: string, newPassword: string) {
    return this.db.user.update({
      where: { id },
      data: { password: await hashPassword(newPassword) },
      select: { id: true },
    });
  }

  async remove(id: string, actorId?: string, force = false) {
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, "Usuario no encontrado");

    // Eliminación forzada (solo ADMIN, gateado en la ruta): borra aunque el
    // usuario tenga historial ligado. Las FKs requeridas (no admiten null) se
    // reasignan al administrador que ejecuta la acción; las opcionales se
    // limpian. Salta el paso intermedio de baja lógica.
    if (force) {
      if (!actorId) {
        throw new HttpError(400, "No se pudo determinar el administrador que ejecuta la acción");
      }
      if (actorId === id) {
        throw new HttpError(400, "No puedes eliminar definitivamente tu propia cuenta");
      }
      const actor = await this.db.user.findUnique({ where: { id: actorId } });
      if (!actor) throw new HttpError(400, "Administrador no encontrado");

      await this.db.$transaction([
        // FKs requeridas (no nulas): se reasignan al admin que ejecuta el borrado.
        this.db.ticket.updateMany({ where: { creadoPorId: id }, data: { creadoPorId: actorId } }),
        this.db.ticketComment.updateMany({ where: { autorId: id }, data: { autorId: actorId } }),
        this.db.inventoryMovement.updateMany({ where: { userId: id }, data: { userId: actorId } }),
        // FKs opcionales: se limpian.
        this.db.ticket.updateMany({ where: { asignadoAId: id }, data: { asignadoAId: null } }),
        this.db.ticketHistory.updateMany({ where: { autorId: id }, data: { autorId: null } }),
        this.db.cartaResponsiva.updateMany({ where: { creadoPorId: id }, data: { creadoPorId: null } }),
        this.db.cartaResponsiva.updateMany({ where: { responsableId: id }, data: { responsableId: null } }),
        this.db.cartaResponsiva.updateMany({ where: { encargadoId: id }, data: { encargadoId: null } }),
        this.db.materialOutput.updateMany({ where: { registradoPorId: id }, data: { registradoPorId: null } }),
        this.db.deviceHistory.updateMany({ where: { autorId: id }, data: { autorId: null } }),
      ]);

      const data = await this.db.user.delete({
        where: { id },
        select: { id: true, username: true, name: true, role: true, active: true },
      });
      return { soft: false, forced: true, data };
    }

    // Primera eliminación: soft (active=false), igual que departamentos.
    if (user.active) {
      const data = await this.db.user.update({
        where: { id },
        data: { active: false },
        select: { id: true, username: true, name: true, role: true, active: true },
      });
      return { soft: true, data };
    }

    // Segunda eliminación (usuario ya inactivo): física, solo si no tiene
    // historial ligado (tickets, cartas, comentarios, movimientos, etc.) que
    // rompería la integridad referencial.
    const [
      ticketsCreados,
      ticketsAsignados,
      ticketComments,
      ticketHistory,
      cartasCreadas,
      cartasResponsable,
      cartasEncargado,
      deviceHistory,
      inventoryMovements,
      materialOutputs,
    ] = await this.db.$transaction([
      this.db.ticket.count({ where: { creadoPorId: id } }),
      this.db.ticket.count({ where: { asignadoAId: id } }),
      this.db.ticketComment.count({ where: { autorId: id } }),
      this.db.ticketHistory.count({ where: { autorId: id } }),
      this.db.cartaResponsiva.count({ where: { creadoPorId: id } }),
      this.db.cartaResponsiva.count({ where: { responsableId: id } }),
      this.db.cartaResponsiva.count({ where: { encargadoId: id } }),
      this.db.deviceHistory.count({ where: { autorId: id } }),
      this.db.inventoryMovement.count({ where: { userId: id } }),
      this.db.materialOutput.count({ where: { registradoPorId: id } }),
    ]);

    const blockers: string[] = [];
    if (ticketsCreados > 0) blockers.push(`${ticketsCreados} ticket(s) creado(s)`);
    if (ticketsAsignados > 0) blockers.push(`${ticketsAsignados} ticket(s) asignado(s)`);
    if (ticketComments > 0) blockers.push(`${ticketComments} comentario(s) de ticket`);
    if (ticketHistory > 0) blockers.push(`${ticketHistory} evento(s) de historial de ticket`);
    if (cartasCreadas > 0) blockers.push(`${cartasCreadas} carta(s) creada(s)`);
    if (cartasResponsable > 0) blockers.push(`${cartasResponsable} carta(s) como responsable`);
    if (cartasEncargado > 0) blockers.push(`${cartasEncargado} carta(s) como encargado`);
    if (deviceHistory > 0) blockers.push(`${deviceHistory} evento(s) de historial de dispositivo`);
    if (inventoryMovements > 0) blockers.push(`${inventoryMovements} movimiento(s) de inventario`);
    if (materialOutputs > 0) blockers.push(`${materialOutputs} salida(s) de material`);

    if (blockers.length > 0) {
      throw new HttpError(
        400,
        `No se puede eliminar definitivamente: tiene ${blockers.join(", ")} en su historial`
      );
    }

    const data = await this.db.user.delete({
      where: { id },
      select: { id: true, username: true, name: true, role: true, active: true },
    });
    return { soft: false, data };
  }
}