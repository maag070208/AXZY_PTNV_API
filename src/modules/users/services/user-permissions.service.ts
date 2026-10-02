import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { getCatalog, getMatrix, maxScope, scopeOf, isPermission, type PermissionScope } from "@core/permissions";
import type { JwtPayload } from "@core/utils/security";
import type { AuditLogger } from "./user.service";

/**
 * Excepciones de permiso por empleado (Fase 2). Una excepción reemplaza lo que
 * dice el rol para ese permiso: lo sube, lo baja o lo quita (`scope = NONE`).
 * Opcional: motivo y fecha de vencimiento (por defecto, `PERMISOS_EXCEPCION_DIAS`
 * de `sys_config`; 0 = sin vencimiento).
 */
export interface UserPermissionException {
  scope: PermissionScope;
  reason: string | null;
  expiresAt: string | null;
  grantedById: string | null;
}

export interface UserPermissionView {
  permission: string;
  module: string;
  name: string;
  scopes: PermissionScope[];
  sensitive: boolean;
  /** Lo que da el rol (sin excepción). */
  roleScope: PermissionScope;
  /** Lo que resuelve al final (con excepción vigente). */
  effective: PermissionScope;
  exception: UserPermissionException | null;
}

export interface SetExceptionInput {
  scope: PermissionScope;
  reason?: string;
  /** ISO date o `null` para sin vencimiento; ausente = usar la vigencia global. */
  expiresAt?: string | null;
}

const EXCEPTION_DAYS_KEY = "PERMISOS_EXCEPCION_DIAS";
const DEFAULT_EXCEPTION_DAYS = 30;

const rolesScopeOf = (roles: readonly string[], permission: string): PermissionScope => {
  const matrix = getMatrix();
  let scope: PermissionScope = "NONE";
  for (const role of roles) scope = maxScope(scope, matrix[role]?.[permission] ?? "NONE");
  return scope;
};

export class UserPermissionsService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  private async loadUser(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        departmentId: true,
        extraRoles: { select: { role: true } },
        permissionGrants: { select: { permission: true, scope: true, reason: true, expiresAt: true, grantedById: true } },
      },
    });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND");
    const roles = [user.role, ...user.extraRoles.map((r) => r.role)];
    return { ...user, roles };
  }

  /** Catálogo activo con el alcance del rol, la excepción y el efectivo. */
  async list(userId: string): Promise<UserPermissionView[]> {
    const user = await this.loadUser(userId);
    const exceptions = new Map(user.permissionGrants.map((g) => [g.permission, g]));

    return getCatalog()
      .filter((permission) => permission.active)
      .map((permission) => {
        const grant = exceptions.get(permission.key);
        const effective = scopeOf(
          {
            id: user.id,
            role: user.role,
            roles: user.roles,
            departmentId: user.departmentId,
            exceptions: user.permissionGrants.map((g) => ({
              permission: g.permission,
              scope: g.scope,
              expiresAt: g.expiresAt,
            })),
          },
          permission.key
        );
        return {
          permission: permission.key,
          module: permission.module,
          name: permission.name,
          scopes: permission.scopes,
          sensitive: permission.sensitive,
          roleScope: rolesScopeOf(user.roles, permission.key),
          effective,
          exception: grant
            ? {
                scope: grant.scope,
                reason: grant.reason,
                expiresAt: grant.expiresAt?.toISOString() ?? null,
                grantedById: grant.grantedById,
              }
            : null,
        };
      });
  }

  private async defaultExpiry(): Promise<Date | null> {
    const row = await this.db.sysConfig.findUnique({ where: { key: EXCEPTION_DAYS_KEY } });
    const days = Number(row?.value ?? "");
    const effectiveDays = Number.isFinite(days) && days >= 0 ? days : DEFAULT_EXCEPTION_DAYS;
    if (effectiveDays <= 0) return null;
    return new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000);
  }

  async set(
    userId: string,
    permission: string,
    input: SetExceptionInput,
    actor: JwtPayload
  ): Promise<UserPermissionView[]> {
    if (actor.id === userId) {
      throw new HttpError(400, "CANNOT_CHANGE_OWN_PERMISSIONS");
    }
    const definition = getCatalog().find((p) => p.key === permission);
    if (!isPermission(permission) || !definition) {
      throw new HttpError(400, "PERMISSION_DOES_NOT_EXIST", { permission });
    }
    const valid = new Set<string>([...definition.scopes, "NONE"]);
    if (!valid.has(input.scope)) {
      throw new HttpError(400, "INVALID_SCOPE_FOR_PERMISSION", { permission, scope: input.scope });
    }
    // Un permiso sensible solo lo otorga quien lo tiene con alcance Todo (ADMIN).
    if (definition.sensitive && scopeOf(actor, permission) !== "ALL") {
      throw new HttpError(403, "SENSITIVE_PERMISSION_REQUIRES_ADMIN", { permission });
    }

    const expiresAt =
      input.expiresAt === undefined
        ? await this.defaultExpiry()
        : input.expiresAt === null
          ? null
          : new Date(input.expiresAt);

    await this.db.$transaction(async (tx) => {
      const previous = await tx.userPermission.findUnique({
        where: { userId_permission: { userId, permission } },
      });
      await tx.userPermission.upsert({
        where: { userId_permission: { userId, permission } },
        create: { userId, permission, scope: input.scope, reason: input.reason ?? null, expiresAt, grantedById: actor.id },
        update: { scope: input.scope, reason: input.reason ?? null, expiresAt, grantedById: actor.id },
      });
      await this.audit?.(
        {
          action: "PERMISSION_EXCEPTION_SET",
          entityType: "UserPermission",
          entityId: `${userId}|${permission}`,
          userId: actor.id,
          previousState: previous ? { scope: previous.scope } : undefined,
          newState: { scope: input.scope },
          metadata: { reason: input.reason ?? null, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx
      );
    });

    return this.list(userId);
  }

  async remove(userId: string, permission: string, actorId: string): Promise<UserPermissionView[]> {
    const existing = await this.db.userPermission.findUnique({
      where: { userId_permission: { userId, permission } },
    });
    if (!existing) {
      throw new HttpError(404, "PERMISSION_EXCEPTION_NOT_FOUND", { permission });
    }
    await this.db.$transaction(async (tx) => {
      await tx.userPermission.delete({ where: { userId_permission: { userId, permission } } });
      await this.audit?.(
        {
          action: "PERMISSION_EXCEPTION_REMOVED",
          entityType: "UserPermission",
          entityId: `${userId}|${permission}`,
          userId: actorId,
          previousState: { scope: existing.scope },
        },
        tx
      );
    });
    return this.list(userId);
  }
}
