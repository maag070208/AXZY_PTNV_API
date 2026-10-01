import type { Permission, Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { isRole, loadPermissionsFromDb } from "@core/permissions";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  type MatrixChange,
  type PermissionCatalogCreateInput,
  type PermissionCatalogUpdateInput,
  type RoleCreateInput,
  type RoleUpdateInput,
} from "../models/dto/permission.dto";
import type {
  PermissionCatalog,
  RoleAdmin,
  RolesAdminData,
} from "../models/entity/permission.entity";

const MATRIX_MAX = 500;
const PERMISSION_ADMIN = "roles.manage";

const toCatalog = (row: Permission): PermissionCatalog => ({
  key: row.key,
  module: row.module,
  name: row.name,
  description: row.description ?? null,
  scopes: [...row.scopes],
  sensitive: row.sensitive,
  active: row.active,
  sortOrder: row.sortOrder,
});

const catalogStatus = (row: Permission) => ({
  module: row.module,
  name: row.name,
  description: row.description ?? null,
  scopes: [...row.scopes],
  sensitive: row.sensitive,
  active: row.active,
  sortOrder: row.sortOrder,
});

type RoleRow = {
  key: string;
  name: string;
  description: string | null;
  module: string | null;
  staff: boolean;
  system: boolean;
  active: boolean;
  sortOrder: number;
};

const toRoleAdmin = (row: RoleRow, userCount: number): RoleAdmin => ({
  key: row.key,
  name: row.name,
  description: row.description ?? null,
  module: row.module ?? null,
  staff: row.staff,
  system: row.system,
  active: row.active,
  sortOrder: row.sortOrder,
  userCount,
});

const roleStatus = (row: RoleRow) => ({
  name: row.name,
  description: row.description ?? null,
  module: row.module ?? null,
  staff: row.staff,
  active: row.active,
  sortOrder: row.sortOrder,
});

/**
 * Administración del catálogo de roles, del catálogo de permisos y de la
 * matriz rol → permiso → alcance. Desde la Fase 1 los roles también viven en
 * la BD (`roles`); el núcleo `@core/permissions` mantiene las caches en memoria
 * y este servicio las recarga tras cada escritura.
 *
 * Cada mutación se audita dentro de la misma `$transaction` que el cambio
 * (mismo patrón que `SysConfigService`). La recarga de caches ocurre **después**
 * del commit, para no dejar memoria y BD desincronizadas.
 */
export class PermissionService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Roles, catálogo completo (incluye inactivos) y matriz con alcance ≠ NINGUNO. */
  async adminData(): Promise<RolesAdminData> {
    const [roles, catalog, matrix] = await Promise.all([
      this.db.role.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { key: true },
      }),
      this.db.permission.findMany({ orderBy: [{ module: "asc" }, { sortOrder: "asc" }] }),
      this.db.rolePermission.findMany({
        where: { scope: { not: "NONE" } },
        select: { role: true, permission: true, scope: true },
      }),
    ]);

    return {
      roles: roles.map((role) => role.key),
      catalog: catalog.map(toCatalog),
      matrix: matrix.map((row) => ({
        role: row.role,
        permission: row.permission,
        scope: row.scope,
      })),
    };
  }

  /** Catálogo activo, para que la web resuelva nombres de permiso. */
  async getActiveCatalog(): Promise<PermissionCatalog[]> {
    const rows = await this.db.permission.findMany({
      where: { active: true },
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    });
    return rows.map(toCatalog);
  }

  /**
   * Personas distintas que tienen el rol, como principal **o** adicional
   * (multi-rol). Es el número que se muestra y el que impide borrar el rol.
   */
  private countRoleUsers(key: string): Promise<number> {
    return this.db.user.count({
      where: { OR: [{ role: key }, { extraRoles: { some: { role: key } } }] },
    });
  }

  /** Roles con el número de personas asignadas (para la pantalla `/roles`). */
  async listRoles(): Promise<RoleAdmin[]> {
    const rows = await this.db.role.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const counts = await Promise.all(rows.map((row) => this.countRoleUsers(row.key)));
    return rows.map((row, index) => toRoleAdmin(row, counts[index]));
  }

  async getRole(key: string): Promise<RoleAdmin> {
    const row = await this.db.role.findUnique({ where: { key } });
    if (!row) throw new HttpError(404, "ROLE_NOT_FOUND", { key });
    return toRoleAdmin(row, await this.countRoleUsers(key));
  }

  async createRole(dto: RoleCreateInput, actorId: string): Promise<RoleAdmin> {
    const existing = await this.db.role.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new HttpError(409, "ROLE_KEY_TAKEN", { key: dto.key });
    }
    // Duplicar: el rol nuevo arranca con la matriz del rol origen.
    if (dto.copyFrom) {
      const source = await this.db.role.findUnique({ where: { key: dto.copyFrom } });
      if (!source) throw new HttpError(404, "ROLE_NOT_FOUND", { key: dto.copyFrom });
    }

    const created = await this.db.$transaction(async (tx) => {
      const row = await tx.role.create({
        data: {
          key: dto.key,
          name: dto.name,
          description: dto.description ?? null,
          module: dto.module ?? null,
          staff: dto.staff ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      const copied = dto.copyFrom
        ? await tx.rolePermission.findMany({
            where: { role: dto.copyFrom, scope: { not: "NONE" } },
            select: { permission: true, scope: true },
          })
        : [];
      if (copied.length > 0) {
        await tx.rolePermission.createMany({
          data: copied.map((cell) => ({ role: row.key, permission: cell.permission, scope: cell.scope })),
        });
      }

      if (this.audit) {
        await this.audit(
          {
            action: "ROLE_CREATED",
            entityType: "Role",
            entityId: row.key,
            userId: actorId,
            newState: roleStatus(row),
            ...(dto.copyFrom && { metadata: { copiedFrom: dto.copyFrom, permissions: copied.length } }),
          },
          tx
        );
        // Cada celda copiada queda en la bitácora igual que una edición de la matriz.
        for (const cell of copied) {
          await this.audit(
            {
              action: "ROLE_PERMISSIONS_UPDATED",
              entityType: "RolePermission",
              entityId: `${row.key}|${cell.permission}`,
              userId: actorId,
              newState: { scope: cell.scope },
              metadata: { copiedFrom: dto.copyFrom },
            },
            tx
          );
        }
      }
      return row;
    });

    await loadPermissionsFromDb(this.db);
    return toRoleAdmin(created, 0);
  }

  async updateRole(
    key: string,
    dto: RoleUpdateInput,
    actorId: string
  ): Promise<RoleAdmin> {
    const previous = await this.db.role.findUnique({ where: { key } });
    if (!previous) {
      throw new HttpError(404, "ROLE_NOT_FOUND", { key });
    }

    // Un rol de sistema no se renombra ni se desactiva desde aquí; sus permisos
    // sí se editan (matriz). Evita dejar la base sin roles base.
    if (previous.system && (dto.name !== undefined || dto.active !== undefined)) {
      throw new HttpError(409, "ROLE_SYSTEM_PROTECTED", { key });
    }

    if (dto.active === false) {
      await this.assertRolesManageSurvives(key);
    }

    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.module !== undefined) data.module = dto.module;
    if (dto.staff !== undefined) data.staff = dto.staff;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    const previousState = roleStatus(previous);

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.role.update({ where: { key }, data });

      if (this.audit) {
        await this.audit(
          {
            action: "ROLE_UPDATED",
            entityType: "Role",
            entityId: key,
            userId: actorId,
            previousState,
            newState: roleStatus(row),
          },
          tx
        );
      }
      return row;
    });

    await loadPermissionsFromDb(this.db);
    return toRoleAdmin(updated, await this.countRoleUsers(key));
  }

  async deleteRole(key: string, actorId: string): Promise<void> {
    const role = await this.db.role.findUnique({ where: { key } });
    if (!role) throw new HttpError(404, "ROLE_NOT_FOUND", { key });
    if (role.system) {
      throw new HttpError(409, "ROLE_SYSTEM_PROTECTED", { key });
    }

    // Cuenta también a quien lo tiene como rol adicional: borrarlo se lo quitaría
    // en silencio (FK en cascada de `user_roles`).
    const userCount = await this.countRoleUsers(key);
    if (userCount > 0) {
      throw new HttpError(409, "ROLE_HAS_USERS", { key, userCount });
    }

    await this.assertRolesManageSurvives(key);

    await this.db.$transaction(async (tx) => {
      await tx.role.delete({ where: { key } });
      if (this.audit) {
        await this.audit(
          {
            action: "ROLE_DELETED",
            entityType: "Role",
            entityId: key,
            userId: actorId,
            previousState: roleStatus(role),
          },
          tx
        );
      }
    });

    await loadPermissionsFromDb(this.db);
  }

  async createCatalog(
    dto: PermissionCatalogCreateInput,
    actorId: string
  ): Promise<PermissionCatalog> {
    const existing = await this.db.permission.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new HttpError(409, "PERMISSION_KEY_TAKEN", { key: dto.key });
    }

    const created = await this.db.$transaction(async (tx) => {
      const row = await tx.permission.create({
        data: {
          key: dto.key,
          module: dto.module,
          name: dto.name,
          description: dto.description ?? null,
          scopes: dto.scopes,
          sensitive: dto.sensitive ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      if (this.audit) {
        await this.audit(
          {
            action: "PERMISSION_CREATED",
            entityType: "Permission",
            entityId: row.key,
            userId: actorId,
            newState: catalogStatus(row),
          },
          tx
        );
      }
      return row;
    });

    await loadPermissionsFromDb(this.db);
    return toCatalog(created);
  }

  async updateCatalog(
    key: string,
    dto: PermissionCatalogUpdateInput,
    actorId: string
  ): Promise<PermissionCatalog> {
    const previous = await this.db.permission.findUnique({ where: { key } });
    if (!previous) {
      throw new HttpError(404, "PERMISSION_NOT_FOUND", { key });
    }

    const data: Prisma.PermissionUpdateInput = {};
    if (dto.module !== undefined) data.module = dto.module;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sensitive !== undefined) data.sensitive = dto.sensitive;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    if (dto.scopes !== undefined) {
      const grants = await this.db.rolePermission.findMany({ where: { permission: key } });
      const outsideScope = grants.filter(
        (row) => row.scope !== "NONE" && !dto.scopes!.includes(row.scope)
      );
      if (outsideScope.length > 0) {
        const item = outsideScope.map((row) => `${row.role}=${row.scope}`).join(", ");
        throw new HttpError(409, "SCOPE_HAS_GRANTS", { grants: item }, { grants: outsideScope.map((row) => ({ role: row.role, scope: row.scope })) });
      }
      data.scopes = dto.scopes;
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "UPDATE_FIELDS_REQUIRED");
    }

    const previousState = catalogStatus(previous);

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.permission.update({ where: { key }, data });

      if (this.audit) {
        await this.audit(
          {
            action: "PERMISSION_UPDATED",
            entityType: "Permission",
            entityId: key,
            userId: actorId,
            previousState,
            newState: catalogStatus(row),
          },
          tx
        );
      }
      return row;
    });

    await loadPermissionsFromDb(this.db);
    return toCatalog(updated);
  }

  /**
   * Aplica un lote de celdas de la matriz. Valida cada fila contra el catálogo
   * (permiso existente y activo, rol existente y activo, alcance permitido),
   * impide dejar el sistema sin ningún rol activo con `roles.manage` y escribe
   * también los `NINGUNO` (tombstone: nunca borra filas). Audita celda por celda
   * y recarga la cache tras commit.
   */
  async saveMatrix(
    changes: MatrixChange[],
    actorId: string
  ): Promise<{ updated: number }> {
    if (changes.length === 0) {
      throw new HttpError(400, "CHANGES_REQUIRED");
    }
    if (changes.length > MATRIX_MAX) {
      throw new HttpError(400, "TOO_MANY_CHANGES", { max: MATRIX_MAX });
    }

    const keys = [...new Set(changes.map((change) => change.permission))];
    const permissions = await this.db.permission.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(permissions.map((permission) => [permission.key, permission]));

    for (const change of changes) {
      if (!isRole(change.role)) {
        throw new HttpError(400, "INVALID_ROLE", { role: change.role });
      }
      const definition = byKey.get(change.permission);
      if (!definition) {
        throw new HttpError(400, "PERMISSION_DOES_NOT_EXIST", { permission: change.permission });
      }
      if (!definition.active) {
        throw new HttpError(400, "PERMISSION_INACTIVE", { permission: change.permission });
      }
      const valid = new Set<string>([...definition.scopes, "NONE"]);
      if (!valid.has(change.scope)) {
        throw new HttpError(400, "INVALID_SCOPE_FOR_PERMISSION", { permission: change.permission, scope: change.scope });
      }
    }

    const removingManage = changes.filter(
      (change) => change.permission === PERMISSION_ADMIN && change.scope === "NONE"
    );
    if (removingManage.length > 0) {
      const removed = new Set(removingManage.map((change) => change.role));
      await this.assertSomeRoleKeepsManage(removed);
    }

    await this.db.$transaction(async (tx) => {
      const previous = await tx.rolePermission.findMany({
        where: {
          OR: changes.map((change) => ({ role: change.role, permission: change.permission })),
        },
      });
      const previousByCell = new Map(
        previous.map((row) => [`${row.role}|${row.permission}`, row.scope])
      );

      for (const change of changes) {
        const entityId = `${change.role}|${change.permission}`;
        const before = previousByCell.get(entityId);

        await tx.rolePermission.upsert({
          where: { role_permission: { role: change.role, permission: change.permission } },
          create: {
            role: change.role,
            permission: change.permission,
            scope: change.scope,
          },
          update: { scope: change.scope },
        });

        if (this.audit) {
          await this.audit(
            {
              action: "ROLE_PERMISSIONS_UPDATED",
              entityType: "RolePermission",
              entityId,
              userId: actorId,
              previousState: before ? { scope: before } : undefined,
              newState: { scope: change.scope },
            },
            tx
          );
        }
      }
    });

    await loadPermissionsFromDb(this.db);
    return { updated: changes.length };
  }

  /** Recarga catálogo, roles y matriz desde la BD (multi-instancia). */
  async reload(): Promise<void> {
    await loadPermissionsFromDb(this.db);
  }

  /**
   * Guard anti-lockout: algún rol **activo** distinto de `removing` debe
   * conservar `roles.manage` con alcance ≠ NINGUNO.
   */
  private async assertRolesManageSurvives(removing: string): Promise<void> {
    await this.assertSomeRoleKeepsManage(new Set([removing]));
  }

  private async assertSomeRoleKeepsManage(removedRoles: ReadonlySet<string>): Promise<void> {
    const [grants, activeRoles] = await Promise.all([
      this.db.rolePermission.findMany({
        where: { permission: PERMISSION_ADMIN, scope: { not: "NONE" } },
        select: { role: true },
      }),
      this.db.role.findMany({ where: { active: true }, select: { key: true } }),
    ]);
    const active = new Set(activeRoles.map((role) => role.key));
    const survivors = grants.filter(
      (grant) => !removedRoles.has(grant.role) && active.has(grant.role)
    );
    if (survivors.length === 0) {
      throw new HttpError(409, "ADMIN_PERMISSION_REQUIRED", { permission: PERMISSION_ADMIN });
    }
  }
}
