import type { Permission, Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { loadPermissionsFromDb } from "@core/permissions";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  ROLES,
  type MatrixChange,
  type PermissionCatalogCreateInput,
  type PermissionCatalogUpdateInput,
} from "../models/dto/permission.dto";
import type {
  PermissionCatalog,
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

/**
 * Administración del catálogo de permisos y de la matriz rol → permiso →
 * alcance. Desde el Incremento 2 ambas viven en la BD (`permisos`,
 * `rol_permisos`); el núcleo `@core/permisos` mantiene la cache en memoria y
 * este servicio la recarga tras cada escritura.
 *
 * Cada mutación se audita dentro de la misma `$transaction` que el cambio
 * (mismo patrón que `SysConfigService`): si la transacción falla, el log no se
 * escribe. La recarga de caches ocurre **después** del commit, para no dejar
 * memoria y BD desincronizadas.
 */
export class PermissionService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Roles, catálogo completo (incluye inactivos) y matriz con alcance ≠ NINGUNO. */
  async adminData(): Promise<RolesAdminData> {
    const [catalog, matrix] = await Promise.all([
      this.db.permission.findMany({ orderBy: [{ module: "asc" }, { sortOrder: "asc" }] }),
      this.db.rolePermission.findMany({
        where: { scope: { not: "NONE" } },
        select: { role: true, permission: true, scope: true },
      }),
    ]);

    return {
      roles: [...ROLES],
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
   * (permiso existente y activo, alcance permitido), impide el lockout de
   * ADMIN sobre `roles.administrar` y escribe también los `NINGUNO` (tombstone:
   * nunca borra filas). Audita celda por celda y recarga la cache tras commit.
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
      if (!ROLES.includes(change.role)) {
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

    const leavesWithoutAdmin = changes.some(
      (change) =>
        change.role === "ADMIN" &&
        change.permission === PERMISSION_ADMIN &&
        change.scope === "NONE"
    );
    if (leavesWithoutAdmin) {
      throw new HttpError(409, "ADMIN_PERMISSION_REQUIRED", { permission: PERMISSION_ADMIN });
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

  /** Recarga catálogo y matriz desde la BD (útil en despliegues multi-instancia). */
  async reload(): Promise<void> {
    await loadPermissionsFromDb(this.db);
  }
}
