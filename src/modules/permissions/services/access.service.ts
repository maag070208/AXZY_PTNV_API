import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  definitionOf,
  definitionOfRole,
  getCatalog,
  getMatrix,
  isPermission,
  scopeOf,
  type PermissionScope,
  type UserPermissions,
} from "@core/permissions";
import {
  explainActionPolicies,
  policyAction,
  rulesForAction,
  type PolicyExplanation,
} from "@core/policies";
import {
  filterDateRange,
  filterEnum,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  AccessActivityRow,
  AccessException,
  AccessMember,
  AccessSimulation,
  SimulationInput,
  UserAccessView,
} from "../models/entity/access.entity";

/**
 * Acciones de `audit_logs` que pertenecen al control de acceso: lo que muestra
 * la pestaña "Actividad" de `/roles` (cambios de roles, matriz, catálogo,
 * políticas, excepciones, asignación de roles y accesos denegados).
 */
export const ACCESS_CONTROL_ACTIONS = [
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_DELETED",
  "ROLE_PERMISSIONS_UPDATED",
  "PERMISSION_CREATED",
  "PERMISSION_UPDATED",
  "POLICY_CREATED",
  "POLICY_UPDATED",
  "POLICY_DELETED",
  "PERMISSION_EXCEPTION_SET",
  "PERMISSION_EXCEPTION_REMOVED",
  "USER_ROLE_ADDED",
  "USER_ROLE_REMOVED",
  "ACCESS_DENIED",
] as const;

const currentGrant = (now: Date): Prisma.UserPermissionWhereInput => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

const memberSelect = (now: Date) =>
  ({
    id: true,
    name: true,
    username: true,
    employeeNumber: true,
    jobTitle: true,
    active: true,
    role: true,
    department: { select: { name: true } },
    extraRoles: { select: { role: true }, orderBy: { createdAt: "asc" } },
    _count: { select: { permissionGrants: { where: currentGrant(now) } } },
  }) satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: ReturnType<typeof memberSelect> }>;

const toMember = (row: MemberRow): AccessMember => ({
  id: row.id,
  name: row.name,
  username: row.username,
  employeeNumber: row.employeeNumber ?? null,
  jobTitle: row.jobTitle ?? null,
  department: row.department?.name ?? null,
  active: row.active,
  role: row.role,
  extraRoles: row.extraRoles.map((r) => r.role).filter((role) => role !== row.role),
  exceptions: row._count.permissionGrants,
});

/** Alcance que da cada rol (solo ≠ NONE). La matriz en cache ya omite roles y permisos inactivos. */
const scopesByRole = (roles: readonly string[], permission: string): Record<string, PermissionScope> => {
  const matrix = getMatrix();
  const out: Record<string, PermissionScope> = {};
  for (const role of roles) {
    const scope = matrix[role]?.[permission];
    if (scope && scope !== "NONE") out[role] = scope;
  }
  return out;
};

/** Normaliza el registro del probador contra los campos que la acción declara. */
const parseResource = (
  permission: string,
  raw: SimulationInput["resource"]
): Record<string, string | number | boolean | null> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "INVALID_BODY");
  const definition = policyAction(permission);
  const fields = new Map((definition?.fields ?? []).map((field) => [field.key, field]));
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = fields.get(key);
    if (!field) throw new HttpError(400, "INVALID_POLICY_FIELD", { index: key, field: key });
    if (value === null || value === undefined || value === "") {
      out[key] = null;
    } else if (field.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new HttpError(400, "INVALID_POLICY_VALUE", { index: key, value: String(value) });
      out[key] = number;
    } else if (field.type === "boolean") {
      if (value !== true && value !== false && value !== "true" && value !== "false") {
        throw new HttpError(400, "INVALID_POLICY_VALUE", { index: key, value: String(value) });
      }
      out[key] = value === true || value === "true";
    } else {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, "INVALID_POLICY_VALUE", { index: key, value: String(value) });
      }
      const text = String(value);
      if (field.type === "enum" && !(field.options ?? []).includes(text)) {
        throw new HttpError(400, "INVALID_POLICY_VALUE", { index: key, value: text });
      }
      out[key] = text;
    }
  }
  return out;
};

/**
 * Consola de acceso de `/roles`: quién tiene cada rol, el acceso efectivo de
 * una persona explicado por origen, el probador (Identidad → RBAC → ABAC) y la
 * bitácora del control de acceso.
 *
 * No reimplementa ninguna decisión: el alcance sale de `scopeOf` (el mismo que
 * usa `requiresPermission`) y las políticas del motor de `@core/policies`.
 */
export class AccessService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Todas las personas con su rol principal, adicionales y excepciones vigentes. */
  async members(): Promise<AccessMember[]> {
    const rows = await this.db.user.findMany({
      select: memberSelect(new Date()),
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return rows.map(toMember);
  }

  private async loadSubject(userId: string) {
    const now = new Date();
    const row = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        ...memberSelect(now),
        departmentId: true,
        permissionGrants: {
          where: currentGrant(now),
          select: { permission: true, scope: true, reason: true, expiresAt: true },
        },
      },
    });
    if (!row) throw new HttpError(404, "USER_NOT_FOUND");
    const member = toMember(row);
    const subject: UserPermissions = {
      id: row.id,
      role: row.role,
      roles: [row.role, ...member.extraRoles],
      departmentId: row.departmentId,
      exceptions: row.permissionGrants.map((grant) => ({
        permission: grant.permission,
        scope: grant.scope,
        expiresAt: grant.expiresAt,
      })),
    };
    const exceptions = new Map<string, AccessException>(
      row.permissionGrants.map((grant) => [
        grant.permission,
        { scope: grant.scope, reason: grant.reason ?? null, expiresAt: grant.expiresAt?.toISOString() ?? null },
      ])
    );
    return { member, subject, exceptions };
  }

  /** Acceso efectivo de una persona, permiso por permiso, con su origen. */
  async userAccess(userId: string): Promise<UserAccessView> {
    const { member, subject, exceptions } = await this.loadSubject(userId);
    const roles = [member.role, ...member.extraRoles];
    return {
      user: member,
      roles: roles.map((key) => ({
        key,
        primary: key === member.role,
        active: definitionOfRole(key)?.active ?? false,
      })),
      permissions: getCatalog()
        .filter((permission) => permission.active)
        .map((permission) => ({
          key: permission.key,
          effective: scopeOf(subject, permission.key),
          byRole: scopesByRole(roles, permission.key),
          exception: exceptions.get(permission.key) ?? null,
        })),
    };
  }

  /**
   * Agrega el rol a la persona como **adicional** (multi-rol). El principal se
   * cambia en la ficha del usuario, no aquí.
   */
  async addRoleMember(roleKey: string, userId: string, actorId: string): Promise<AccessMember> {
    const role = definitionOfRole(roleKey);
    if (!role) throw new HttpError(404, "ROLE_NOT_FOUND", { key: roleKey });
    if (!role.active) throw new HttpError(409, "ROLE_INACTIVE", { key: roleKey });

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, extraRoles: { select: { role: true } } },
    });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND");
    if (user.role === roleKey || user.extraRoles.some((r) => r.role === roleKey)) {
      throw new HttpError(409, "ROLE_ALREADY_ASSIGNED", { name: user.name, key: roleKey });
    }

    await this.db.$transaction(async (tx) => {
      await tx.userRole.create({ data: { userId, role: roleKey } });
      if (this.audit) {
        await this.audit(
          {
            action: "USER_ROLE_ADDED",
            entityType: "UserRole",
            entityId: `${userId}|${roleKey}`,
            userId: actorId,
            newState: { role: roleKey, primary: false },
            metadata: { user: user.name },
          },
          tx
        );
      }
    });
    return this.member(userId);
  }

  /** Quita un rol adicional. El principal no se quita desde aquí (409 `ROLE_IS_PRIMARY`). */
  async removeRoleMember(roleKey: string, userId: string, actorId: string): Promise<AccessMember> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, extraRoles: { select: { role: true } } },
    });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND");
    if (user.role === roleKey) {
      throw new HttpError(409, "ROLE_IS_PRIMARY", { name: user.name, key: roleKey });
    }
    if (!user.extraRoles.some((r) => r.role === roleKey)) {
      throw new HttpError(404, "ROLE_NOT_ASSIGNED", { name: user.name, key: roleKey });
    }

    await this.db.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { userId_role: { userId, role: roleKey } } });
      if (this.audit) {
        await this.audit(
          {
            action: "USER_ROLE_REMOVED",
            entityType: "UserRole",
            entityId: `${userId}|${roleKey}`,
            userId: actorId,
            previousState: { role: roleKey, primary: false },
            metadata: { user: user.name },
          },
          tx
        );
      }
    });
    return this.member(userId);
  }

  private async member(userId: string): Promise<AccessMember> {
    const row = await this.db.user.findUnique({ where: { id: userId }, select: memberSelect(new Date()) });
    if (!row) throw new HttpError(404, "USER_NOT_FOUND");
    return toMember(row);
  }

  /**
   * Probador: ¿esta persona puede hacer esta acción (sobre este registro)?
   * Recorre las mismas capas que una petición real:
   * 1. Identidad — la cuenta existe y está activa (`authenticate`).
   * 2. RBAC — el permiso está activo y su alcance efectivo ≠ NONE (`requiresPermission`).
   * 3. ABAC — las políticas de la acción sobre el registro (`evaluateActionPolicies`).
   */
  async simulate(input: SimulationInput): Promise<AccessSimulation> {
    const definition = definitionOf(input.permission);
    if (!definition) {
      throw new HttpError(400, "PERMISSION_DOES_NOT_EXIST", { permission: input.permission });
    }
    const resource = parseResource(input.permission, input.resource);
    const { member, subject, exceptions } = await this.loadSubject(input.userId);
    const roles = [member.role, ...member.extraRoles];

    const permissionActive = isPermission(input.permission);
    const scope: PermissionScope = permissionActive ? scopeOf(subject, input.permission) : "NONE";
    const identityOk = member.active;
    const rbacOk = scope !== "NONE";

    const hasRules = rulesForAction(input.permission).length > 0;
    let explanation: PolicyExplanation | null = null;
    if (identityOk && rbacOk && hasRules) {
      explanation = explainActionPolicies(input.permission, subject, resource);
    }
    const abacOk = explanation ? explanation.decision.allowed : true;

    return {
      allowed: identityOk && rbacOk && abacOk,
      identity: { ok: identityOk, active: member.active },
      rbac: {
        ok: rbacOk,
        permissionActive,
        scope,
        byRole: scopesByRole(roles, input.permission),
        exception: exceptions.get(input.permission) ?? null,
      },
      abac: {
        evaluated: explanation !== null,
        ok: abacOk,
        hasRules,
        supportsContext: policyAction(input.permission) !== undefined,
        explanation,
      },
    };
  }

  /** Bitácora del control de acceso (tabla server-side). */
  async activity(params: ITDataTableFetchParams): Promise<{ data: AccessActivityRow[]; total: number }> {
    const { page, limit, filters, sort } = params;
    const action = filterEnum(filters, "action", ACCESS_CONTROL_ACTIONS);
    const createdAt = filterDateRange(filters, "createdAt");
    const entity = filterText(filters, "entityId");
    const actor = filterText(filters, "actor");

    const and: Prisma.AuditLogWhereInput[] = [
      { action: action ?? { in: [...ACCESS_CONTROL_ACTIONS] } },
    ];
    if (createdAt) and.push({ createdAt });
    if (entity) and.push({ entityId: entity });
    if (actor) {
      // Los registros del servicio guardan el id del actor; el nombre se busca en usuarios.
      const people = await this.db.user.findMany({
        where: { OR: [{ name: actor }, { username: actor }] },
        select: { id: true },
      });
      and.push({ OR: [{ userName: actor }, { userId: { in: people.map((p) => p.id) } }] });
    }
    const where: Prisma.AuditLogWhereInput = { AND: and };

    const [total, rows] = await this.db.$transaction([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: orderByOf(
          sort,
          { createdAt: "createdAt", action: "action", entityId: "entityId", actor: "userId" },
          [{ createdAt: "desc" }]
        ) as Prisma.AuditLogOrderByWithRelationInput[],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => !!id))];
    const people = ids.length
      ? await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true } })
      : [];
    const byId = new Map(people.map((person) => [person.id, person]));

    return {
      total,
      data: rows.map((row) => {
        const person = row.userId ? byId.get(row.userId) : undefined;
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          actor: {
            id: row.userId ?? null,
            name: person?.name ?? null,
            username: person?.username ?? row.userName ?? null,
          },
          previousState: (row.previousState as Record<string, unknown> | null) ?? null,
          newState: (row.newState as Record<string, unknown> | null) ?? null,
          metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        };
      }),
    };
  }
}
