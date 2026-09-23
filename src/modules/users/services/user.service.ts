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
import type { AuditPort } from "@modules/audit";
import type { NotificationPort } from "@modules/notifications";
import { sendEmail, sendNotificationEmail } from "@core/services/mail";
import {
  welcomeEmail,
  userDeactivatedEmail,
  userReactivatedEmail,
} from "@core/services/email-templates";
import type {
  UserCreateInput,
  UserUpdateInput,
  DeactivateUserInput,
} from "../models/dto/user.dto";

const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  segundoNombre: true,
  apellidoPaterno: true,
  apellidoMaterno: true,
  role: true,
  active: true,
  puesto: true,
  numeroEmpleado: true,
  empresa: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  subareaId: true,
  subarea: { select: { id: true, name: true } },
  deactivatedAt: true,
  deactivatedById: true,
  deactivatedBy: { select: { id: true, name: true } },
  deactivationReason: true,
  createdAt: true,
} as const;

type UserRole = UserCreateInput["role"];

/** Puerto de auditoría (DIP). Si no se inyecta, los logs no se escriben. */
export type AuditLogger = AuditPort["createLog"];

export class UserService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly notifications?: NotificationPort
  ) {}

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

  async create(data: UserCreateInput, actorId?: string) {
    const exists = await this.db.user.findUnique({ where: { username: data.username } });
    if (exists) {
      throw new HttpError(409, {
        code: "USERNAME_TAKEN",
        message: "El username ya existe",
      });
    }

    if (data.numeroEmpleado) {
      const empExists = await this.db.user.findUnique({
        where: { numeroEmpleado: data.numeroEmpleado },
      });
      if (empExists) {
        throw new HttpError(409, {
          code: "NUMERO_EMPLEADO_TAKEN",
          message: "Ya existe un usuario con ese número de empleado",
        });
      }
    }

    if (data.email) {
      const emailExists = await this.db.user.findUnique({
        where: { email: data.email },
      });
      if (emailExists) {
        throw new HttpError(409, {
          code: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese correo",
        });
      }
    }

    const created = await this.db.user.create({
      data: {
        username: data.username,
        email: data.email,
        password: await hashPassword(data.password),
        name: data.name,
        segundoNombre: data.segundoNombre,
        apellidoPaterno: data.apellidoPaterno,
        apellidoMaterno: data.apellidoMaterno,
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
        segundoNombre: true,
        apellidoPaterno: true,
        apellidoMaterno: true,
        role: true,
        active: true,
        puesto: true,
        numeroEmpleado: true,
        empresa: true,
        departmentId: true,
        subareaId: true,
      },
    });

    const actor = actorId ?? created.id;

    // Notificación in-app a admin/HR (fire-and-forget). No bloquea la respuesta.
    void this.notifications?.notifyUserCreated({
      userId: created.id,
      actorId: actor,
      userName: created.name,
      userEmail: created.email,
    }).catch(() => {
      /* el error ya se registra dentro de la implementación */
    });

    // Welcome email al empleado (fire-and-forget). Solo si hay email.
    if (created.email) {
      const { subject, html } = welcomeEmail({
        to: created.email,
        name: created.name,
        username: created.username,
        tempPassword: data.password,
      });
      void sendEmail({ to: created.email, subject, html, skipStakeholders: true }).catch(() => {
        /* el error ya se registra dentro de sendEmail */
      });
    }

    // Correo de registro a los NOTIFICATION_EMAILS del catálogo (sys_config).
    // Es una versión distinta a la del empleado: metadata completa de la alta.
    const actorInfo = await this.db.user.findUnique({
      where: { id: actor },
      select: { name: true },
    });
    const actorName = actorInfo?.name ?? "Administrador";
    const departmentName = created.departmentId
      ? (await this.db.department.findUnique({
          where: { id: created.departmentId },
          select: { name: true },
        }))?.name ?? "Sin asignar"
      : "Sin asignar";
    const fechaAlta = new Date().toLocaleString("es-MX");

    {
      const { subject, html } = welcomeEmail({
        to: "",
        name: created.name,
        username: created.username,
        tempPassword: data.password,
        forAdmin: true,
        actorName,
        role: created.role,
        departmentName,
        email: created.email,
        fechaAlta,
      });
      void sendNotificationEmail({ subject, html }).catch(() => {
        /* sendNotificationEmail ya loguea errores internos */
      });
    }

    return created;
  }

  async update(id: string, data: UserUpdateInput) {
    if (data.numeroEmpleado) {
      const dup = await this.db.user.findFirst({
        where: { numeroEmpleado: data.numeroEmpleado, NOT: { id } },
      });
      if (dup) {
        throw new HttpError(409, {
          code: "NUMERO_EMPLEADO_TAKEN",
          message: "Número de empleado duplicado",
        });
      }
    }
    if (data.email) {
      const emailDup = await this.db.user.findFirst({
        where: { email: data.email, NOT: { id } },
      });
      if (emailDup) {
        throw new HttpError(409, {
          code: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese correo",
        });
      }
    }
    return this.db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        segundoNombre: true,
        apellidoPaterno: true,
        apellidoMaterno: true,
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
        this.db.movimiento.updateMany({ where: { usuarioId: id }, data: { usuarioId: actorId } }),
        this.db.movimiento.updateMany({ where: { responsableId: id }, data: { responsableId: actorId } }),
        this.db.prestamo.updateMany({ where: { responsableId: id }, data: { responsableId: actorId } }),
        // FKs opcionales: se limpian.
        this.db.ticket.updateMany({ where: { asignadoAId: id }, data: { asignadoAId: null } }),
        this.db.ticketHistory.updateMany({ where: { autorId: id }, data: { autorId: null } }),
        this.db.materialOutput.updateMany({ where: { registradoPorId: id }, data: { registradoPorId: null } }),
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
      movimientosCreados,
      prestamosResponsable,
      materialOutputs,
    ] = await this.db.$transaction([
      this.db.ticket.count({ where: { creadoPorId: id } }),
      this.db.ticket.count({ where: { asignadoAId: id } }),
      this.db.ticketComment.count({ where: { autorId: id } }),
      this.db.ticketHistory.count({ where: { autorId: id } }),
      this.db.movimiento.count({ where: { usuarioId: id } }),
      this.db.prestamo.count({ where: { responsableId: id } }),
      this.db.materialOutput.count({ where: { registradoPorId: id } }),
    ]);

    const blockers: string[] = [];
    if (ticketsCreados > 0) blockers.push(`${ticketsCreados} ticket(s) creado(s)`);
    if (ticketsAsignados > 0) blockers.push(`${ticketsAsignados} ticket(s) asignado(s)`);
    if (ticketComments > 0) blockers.push(`${ticketComments} comentario(s) de ticket`);
    if (ticketHistory > 0) blockers.push(`${ticketHistory} evento(s) de historial de ticket`);
    if (movimientosCreados > 0) blockers.push(`${movimientosCreados} movimiento(s) de inventario`);
    if (prestamosResponsable > 0) blockers.push(`${prestamosResponsable} préstamo(s) como responsable`);
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

  /**
   * Da de baja a un usuario (soft deactivate). Mantiene `active=false` y
   * registra quién/cuándo/por qué. Envuelto en `$transaction` para que el
   * log de auditoría quede atado al cambio de estado.
   *
   * Rechaza darse de baja a sí mismo (HTTP 400) y dobles bajas (HTTP 409).
   */
  async deactivate(id: string, actorId: string, input: DeactivateUserInput) {
    if (actorId === id) {
      throw new HttpError(400, "No puedes darte de baja a ti mismo");
    }

    const result = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, username: true, name: true, role: true, active: true, email: true, deactivatedAt: true },
      });
      if (!user) throw new HttpError(404, "Usuario no encontrado");
      if (!user.active) {
        throw new HttpError(409, "El usuario ya estaba dado de baja");
      }

      const previousState = { active: true };

      const updated = await tx.user.update({
        where: { id },
        data: {
          active: false,
          deactivatedAt: new Date(),
          deactivatedById: actorId,
          deactivationReason: input.reason,
        },
        select: userSelect,
      });

      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true, name: true },
      });

      if (this.audit) {
        await this.audit(
          {
            action: "USER_DEACTIVATED",
            entityType: "User",
            entityId: id,
            userId: actorId,
            previousState,
            newState: {
              active: false,
              deactivatedAt: updated.deactivatedAt,
              deactivatedById: actorId,
              deactivationReason: input.reason,
            },
            metadata: { reason: input.reason, notifyUser: input.notifyUser },
          },
          tx
        );
      }

      return { updated, user, actor };
    });

    // Notificación in-app a admin/HR (fire-and-forget).
    const fechaBaja = result.updated.deactivatedAt
      ? new Date(result.updated.deactivatedAt).toLocaleString("es-MX")
      : new Date().toLocaleString("es-MX");
    const actorName = result.actor?.name ?? "Administrador";

    void this.notifications?.notifyUserDeactivated({
      userId: result.user.id,
      actorId,
      userName: result.user.name,
      motivo: input.reason,
      fecha: fechaBaja,
    }).catch(() => {
      /* el error ya se registra dentro de la implementación */
    });

    // Notificación al usuario dado de baja (fire-and-forget). El correo del
    // afectado se respeta el checkbox `notifyUser` de la UI.
    if (input.notifyUser && result.user.email) {
      const { subject, html } = userDeactivatedEmail({
        to: result.user.email,
        name: result.user.name,
        motivo: input.reason,
        fecha: fechaBaja,
        byName: actorName,
      });
      void sendEmail({ to: result.user.email, subject, html, skipStakeholders: true }).catch(() => {
        /* el error ya se registra dentro de sendEmail */
      });
    }

    // Correo de registro a los NOTIFICATION_EMAILS del catálogo (sys_config).
    // Se envía SIEMPRE, sin importar `notifyUser`: es la constancia del evento.
    {
      const { subject, html } = userDeactivatedEmail({
        to: "",
        name: result.user.name,
        motivo: input.reason,
        fecha: fechaBaja,
        byName: actorName,
        forAdmin: true,
        role: result.user.role,
      });
      void sendNotificationEmail({ subject, html }).catch(() => {
        /* sendNotificationEmail ya loguea errores internos */
      });
    }

    return result.updated;
  }

  /**
   * Reactiva un usuario previamente dado de baja. Limpia los campos de
   * desactivación y registra el cambio en auditoría.
   */
  async reactivate(id: string, actorId: string) {
    if (actorId === id) {
      throw new HttpError(400, "No puedes reactivarte a ti mismo desde este endpoint");
    }

    const result = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, username: true, name: true, role: true, active: true, deactivatedAt: true, deactivationReason: true },
      });
      if (!user) throw new HttpError(404, "Usuario no encontrado");
      if (user.active) {
        throw new HttpError(409, "El usuario ya estaba activo");
      }

      const previousState = {
        active: false,
        deactivatedAt: user.deactivatedAt,
        deactivationReason: user.deactivationReason,
      };

      const updated = await tx.user.update({
        where: { id },
        data: {
          active: true,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
        },
        select: userSelect,
      });

      if (this.audit) {
        await this.audit(
          {
            action: "USER_REACTIVATED",
            entityType: "User",
            entityId: id,
            userId: actorId,
            previousState,
            newState: { active: true },
          },
          tx
        );
      }

      return updated;
    });

    const actor = await this.db.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    const actorName = actor?.name ?? "Administrador";
    const fecha = new Date().toLocaleString("es-MX");

    // Notificación al empleado reactivado (fire-and-forget). Solo si tiene
    // correo propio.
    if (result.email) {
      const { subject, html } = userReactivatedEmail({
        to: result.email,
        name: result.name,
        fecha,
        byName: actorName,
      });
      void sendEmail({ to: result.email, subject, html, skipStakeholders: true }).catch(() => {
        /* el error ya se registra dentro de sendEmail */
      });
    }

    // Correo de registro a los NOTIFICATION_EMAILS del catálogo (sys_config).
    {
      const { subject, html } = userReactivatedEmail({
        to: "",
        name: result.name,
        fecha,
        byName: actorName,
        forAdmin: true,
        role: result.role,
      });
      void sendNotificationEmail({ subject, html }).catch(() => {
        /* sendNotificationEmail ya loguea errores internos */
      });
    }

    return result;
  }
}