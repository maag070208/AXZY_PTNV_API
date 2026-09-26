import { test, expect } from "@playwright/test";
import type { PrismaClient, Role } from "@prisma/client";
import {
  isPermission,
  getMatrix,
  resetCatalog,
  resetMatrix,
  type PermissionScope,
} from "../../src/core/permissions";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import type { AuditLogInput } from "../../src/modules/audit/models/entity/audit.entity";
import {
  parseScopes,
  parseCatalogCreateBody,
  parseCatalogUpdateBody,
  parseMatrixBody,
} from "../../src/modules/permissions/models/dto/permission.dto";
import { PermissionService } from "../../src/modules/permissions/services/permission.service";

/**
 * Pruebas unitarias del módulo de administración de permisos. Sin BD: el
 * servicio recibe un stub de Prisma y un logger de auditoría en memoria.
 * Se verifica la lógica de negocio (409/404/400, lockout, tombstones) y que
 * la cache de `@core/permisos` se recargue tras cada escritura.
 */

interface PermissionRow {
  key: string;
  module: string;
  name: string;
  description: string | null;
  scopes: PermissionScope[];
  sensitive: boolean;
  active: boolean;
  sortOrder: number;
}

interface MatrixRow {
  role: Role;
  permission: string;
  scope: PermissionScope;
}

const permission = (over: Partial<PermissionRow> & { key: string }): PermissionRow => ({
  module: "Tickets",
  name: "Permiso de prueba",
  description: null,
  scopes: ["OWN", "AREA", "ALL"],
  sensitive: false,
  active: true,
  sortOrder: 0,
  ...over,
});

const matchesPermission = (row: PermissionRow, where?: any): boolean => {
  if (!where) return true;
  const inKeys = where.key?.in;
  if (Array.isArray(inKeys) && !inKeys.includes(row.key)) return false;
  if (where.active !== undefined && row.active !== where.active) return false;
  return true;
};

const matchesRolePermission = (row: MatrixRow, where?: any): boolean => {
  if (!where) return true;
  if (typeof where.permission === "string" && row.permission !== where.permission) return false;
  if (where.scope?.not && row.scope === where.scope.not) return false;
  if (Array.isArray(where.OR)) {
    return where.OR.some(
      (cond: any) =>
        (!cond.role || cond.role === row.role) && (!cond.permission || cond.permission === row.permission)
    );
  }
  return true;
};

const makeDb = (permissionsInitials: PermissionRow[] = [], initialMatrix: MatrixRow[] = []) => {
  const permissions = [...permissionsInitials];
  const matrix = [...initialMatrix];

  const db: any = {
    permission: {
      findUnique: async ({ where }: any) =>
        permissions.find((p) => p.key === where.key) ?? null,
      findMany: async (args: any = {}) =>
        permissions.filter((p) => matchesPermission(p, args.where)),
      create: async ({ data }: any) => {
        const row: PermissionRow = {
          description: null,
          sensitive: false,
          active: true,
          sortOrder: 0,
          ...data,
        };
        permissions.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = permissions.find((p) => p.key === where.key);
        if (!row) throw new Error("permiso no encontrado");
        Object.assign(row, data);
        return row;
      },
    },
    rolePermission: {
      findMany: async (args: any = {}) => matrix.filter((r) => matchesRolePermission(r, args.where)),
      upsert: async ({ where, create, update }: any) => {
        const { role, permission: key } = where.role_permission;
        let row = matrix.find((r) => r.role === role && r.permission === key);
        if (!row) {
          row = { role, permission: key, scope: create.scope };
          matrix.push(row);
        } else {
          row.scope = update.scope;
        }
        return row;
      },
    },
    $transaction: async (cb: any) => cb(db),
  };

  return { db: db as PrismaClient, store: { permissions, matrix } };
};

const makeAudit = () => {
  const logs: AuditLogInput[] = [];
  const audit = async (input: AuditLogInput) => {
    logs.push(input);
    return input;
  };
  return { audit, logs };
};

const capture = (fn: () => unknown): HttpError | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e as HttpError;
  }
};

const captureAsync = async (fn: () => Promise<unknown>): Promise<HttpError | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as HttpError;
  }
};

test.beforeEach(() => {
  resetCatalog();
  resetMatrix();
});

test.describe("DTO de permisos", () => {
  test("parseAlcances deduplica, ordena canónicamente y valida el subset", () => {
    expect(parseScopes(["ALL", "NONE", "OWN"])).toEqual([
      "NONE",
      "OWN",
      "ALL",
    ]);
    expect(capture(() => parseScopes(["ALL", "ALL"]))?.status).toBe(400);
    expect(capture(() => parseScopes(["NOPE"]))?.status).toBe(400);
    expect(capture(() => parseScopes([]))?.status).toBe(400);
    expect(capture(() => parseScopes("ALL"))?.status).toBe(400);
  });

  test("parseCatalogoCreateBody exige clave modulo.accion y campos obligatorios", () => {
    const ok = parseCatalogCreateBody({
      key: "tickets.view",
      module: "Tickets",
      name: "Ver tickets",
      scopes: ["ALL"],
    });
    expect(ok.key).toBe("tickets.view");
    expect(ok.description).toBeUndefined();
    expect(ok.sensitive).toBeUndefined();

    expect(
      capture(() =>
        parseCatalogCreateBody({ key: "TicketsView", module: "T", name: "N", scopes: ["ALL"] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseCatalogCreateBody({ key: "tickets.view", module: "", name: "N", scopes: ["ALL"] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseCatalogCreateBody({ key: "tickets.view", module: "T", name: "N", scopes: [] })
      )?.status
    ).toBe(400);
  });

  test("parseCatalogoUpdateBody exige al menos un campo y admite null en descripcion", () => {
    expect(capture(() => parseCatalogUpdateBody({}))?.status).toBe(400);
    expect(parseCatalogUpdateBody({ active: false })).toEqual({ active: false });
    expect(parseCatalogUpdateBody({ description: null })).toEqual({ description: null });
    expect(
      capture(() => parseCatalogUpdateBody({ sensitive: "sí" }))?.status
    ).toBe(400);
  });

  test("parseMatrizBody valida rol, alcance y tamaño del lote", () => {
    const { changes } = parseMatrixBody({
      changes: [{ role: "ADMIN", permission: "tickets.view", scope: "ALL" }],
    });
    expect(changes).toHaveLength(1);

    expect(capture(() => parseMatrixBody({ changes: [] }))?.status).toBe(400);
    expect(
      capture(() =>
        parseMatrixBody({ changes: [{ role: "SUPER", permission: "a.b", scope: "ALL" }] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseMatrixBody({ changes: [{ role: "ADMIN", permission: "a.b", scope: "NOPE" }] })
      )?.status
    ).toBe(400);

    const grandes = Array.from({ length: 501 }, () => ({
      role: "ADMIN",
      permission: "a.b",
      scope: "ALL",
    }));
    expect(capture(() => parseMatrixBody({ changes: grandes }))?.status).toBe(400);
  });
});

test.describe("createCatalog", () => {
  test("clave duplicada → 409", async () => {
    const { db } = makeDb([permission({ key: "tickets.view" })]);
    const svc = new PermissionService(db);
    const err = await captureAsync(() =>
      svc.createCatalog(
        { key: "tickets.view", module: "Tickets", name: "Ver", scopes: ["ALL"] },
        "u1"
      )
    );
    expect(err?.status).toBe(409);
  });

  test("crea, audita y recarga la cache", async () => {
    const { db, store } = makeDb();
    const { audit, logs } = makeAudit();
    const svc = new PermissionService(db, audit);

    const created = await svc.createCatalog(
      { key: "tickets.view", module: "Tickets", name: "Ver", scopes: ["ALL"], sensitive: true },
      "u1"
    );

    expect(created.key).toBe("tickets.view");
    expect(created.sensitive).toBe(true);
    expect(store.permissions).toHaveLength(1);
    expect(logs[0].action).toBe("PERMISSION_CREATED");
    expect(logs[0].entityType).toBe("Permission");
    expect(logs[0].entityId).toBe("tickets.view");
    expect(logs[0].userId).toBe("u1");
    expect(isPermission("tickets.view")).toBe(true);
  });
});

test.describe("updateCatalog", () => {
  test("404 si el permiso no existe", async () => {
    const { db } = makeDb();
    const svc = new PermissionService(db);
    const err = await captureAsync(() => svc.updateCatalog("no.existe", { name: "X" }, "u1"));
    expect(err?.status).toBe(404);
  });

  test("narrowing de alcances con concesiones fuera → 409", async () => {
    const { db, store } = makeDb(
      [permission({ key: "tickets.view", scopes: ["OWN", "AREA", "ALL"] })],
      [{ role: "MANAGER", permission: "tickets.view", scope: "AREA" }]
    );
    const svc = new PermissionService(db);

    const err = await captureAsync(() =>
      svc.updateCatalog("tickets.view", { scopes: ["OWN", "ALL"] }, "u1")
    );

    expect(err?.status).toBe(409);
    expect(store.permissions[0].scopes).toEqual(["OWN", "AREA", "ALL"]);
  });

  test("activo=false deja de resolver (fail-closed) y audita antes/después", async () => {
    const { db } = makeDb(
      [permission({ key: "tickets.view", scopes: ["ALL"] })],
      [{ role: "ADMIN", permission: "tickets.view", scope: "ALL" }]
    );
    const { audit, logs } = makeAudit();
    const svc = new PermissionService(db, audit);

    const row = await svc.updateCatalog("tickets.view", { active: false }, "u1");

    expect(row.active).toBe(false);
    expect(isPermission("tickets.view")).toBe(false);
    expect(getMatrix().ADMIN?.["tickets.view"]).toBeUndefined();
    expect(logs[0].action).toBe("PERMISSION_UPDATED");
    expect(logs[0].previousState?.active).toBe(true);
    expect(logs[0].newState?.active).toBe(false);
  });
});

test.describe("saveMatrix", () => {
  test("rechaza lote vacío y lotes mayores a 500", async () => {
    const { db } = makeDb();
    const svc = new PermissionService(db);
    expect((await captureAsync(() => svc.saveMatrix([], "u1")))?.status).toBe(400);

    const grandes = Array.from({ length: 501 }, () => ({
      role: "ADMIN" as Role,
      permission: "a.b",
      scope: "ALL" as PermissionScope,
    }));
    expect((await captureAsync(() => svc.saveMatrix(grandes, "u1")))?.status).toBe(400);
  });

  test("valida rol, existencia, actividad y alcance permitido → 400", async () => {
    const { db } = makeDb([
      permission({ key: "tickets.view", scopes: ["OWN", "ALL"] }),
      permission({ key: "tickets.off", active: false, scopes: ["ALL"] }),
    ]);
    const svc = new PermissionService(db);

    expect(
      (
        await captureAsync(() =>
          svc.saveMatrix([{ role: "NOPE" as Role, permission: "tickets.view", scope: "ALL" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatrix([{ role: "ADMIN", permission: "no.existe", scope: "ALL" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatrix([{ role: "ADMIN", permission: "tickets.off", scope: "ALL" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatrix([{ role: "ADMIN", permission: "tickets.view", scope: "AREA" }], "u1")
        )
      )?.status
    ).toBe(400);
  });

  test("lockout de ADMIN sobre roles.administrar → 409 y no escribe", async () => {
    const { db, store } = makeDb(
      [permission({ key: "roles.manage", scopes: ["NONE", "ALL"] })],
      [{ role: "ADMIN", permission: "roles.manage", scope: "ALL" }]
    );
    const svc = new PermissionService(db);

    const err = await captureAsync(() =>
      svc.saveMatrix(
        [{ role: "ADMIN", permission: "roles.manage", scope: "NONE" }],
        "u1"
      )
    );

    expect(err?.status).toBe(409);
    expect(store.matrix[0].scope).toBe("ALL");
  });

  test("escribe NINGUNO (tombstone), audita por celda y recarga la cache", async () => {
    const { db, store } = makeDb(
      [permission({ key: "tickets.view", scopes: ["OWN", "ALL"] })],
      [{ role: "EMPLOYEE", permission: "tickets.view", scope: "OWN" }]
    );
    const { audit, logs } = makeAudit();
    const svc = new PermissionService(db, audit);

    const res = await svc.saveMatrix(
      [{ role: "EMPLOYEE", permission: "tickets.view", scope: "NONE" }],
      "u1"
    );

    expect(res.updated).toBe(1);
    // La fila se conserva con NINGUNO; nunca se borra.
    expect(store.matrix).toHaveLength(1);
    expect(store.matrix[0].scope).toBe("NONE");
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("ROLE_PERMISSIONS_UPDATED");
    expect(logs[0].entityType).toBe("RolePermission");
    expect(logs[0].entityId).toBe("EMPLOYEE|tickets.view");
    expect(logs[0].previousState).toEqual({ scope: "OWN" });
    expect(logs[0].newState).toEqual({ scope: "NONE" });
    // Recarga: NINGUNO no aparece en la matriz efectiva.
    expect(getMatrix().EMPLOYEE?.["tickets.view"]).toBeUndefined();

    // Recarga efectiva: un cambio posterior sí se refleja en la cache.
    await svc.saveMatrix([{ role: "EMPLOYEE", permission: "tickets.view", scope: "ALL" }], "u1");
    expect(getMatrix().EMPLOYEE?.["tickets.view"]).toBe("ALL");
  });
});

test.describe("adminData", () => {
  test("incluye los 6 roles, el catálogo completo (inactivos) y la matriz sin NINGUNO", async () => {
    const { db } = makeDb(
      [
        permission({ key: "a.active", scopes: ["ALL"] }),
        permission({ key: "a.inactive", active: false, scopes: ["ALL"] }),
      ],
      [
        { role: "ADMIN", permission: "a.active", scope: "ALL" },
        { role: "ADMIN", permission: "a.inactive", scope: "NONE" },
      ]
    );
    const svc = new PermissionService(db);

    const data = await svc.adminData();

    expect(data.roles).toHaveLength(6);
    expect(data.catalog.map((p) => p.key)).toEqual(["a.active", "a.inactive"]);
    expect(data.catalog.find((p) => p.key === "a.inactive")?.active).toBe(false);
    expect(data.matrix).toEqual([{ role: "ADMIN", permission: "a.active", scope: "ALL" }]);
  });
});
