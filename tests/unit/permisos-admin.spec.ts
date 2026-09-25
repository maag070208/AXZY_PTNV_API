import { test, expect } from "@playwright/test";
import type { PrismaClient, Role } from "@prisma/client";
import {
  esPermiso,
  getMatriz,
  resetCatalogo,
  resetMatriz,
  type Alcance,
} from "../../src/core/permisos";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import type { AuditLogInput } from "../../src/modules/audit/models/entity/audit.entity";
import {
  parseAlcances,
  parseCatalogoCreateBody,
  parseCatalogoUpdateBody,
  parseMatrizBody,
} from "../../src/modules/permisos/models/dto/permiso.dto";
import { PermisoService } from "../../src/modules/permisos/services/permiso.service";

/**
 * Pruebas unitarias del módulo de administración de permisos. Sin BD: el
 * servicio recibe un stub de Prisma y un logger de auditoría en memoria.
 * Se verifica la lógica de negocio (409/404/400, lockout, tombstones) y que
 * la cache de `@core/permisos` se recargue tras cada escritura.
 */

interface PermisoRow {
  clave: string;
  modulo: string;
  nombre: string;
  descripcion: string | null;
  alcances: Alcance[];
  sensible: boolean;
  activo: boolean;
  orden: number;
}

interface MatrizRow {
  rol: Role;
  permiso: string;
  alcance: Alcance;
}

const permiso = (over: Partial<PermisoRow> & { clave: string }): PermisoRow => ({
  modulo: "Tickets",
  nombre: "Permiso de prueba",
  descripcion: null,
  alcances: ["PROPIO", "AREA", "TODO"],
  sensible: false,
  activo: true,
  orden: 0,
  ...over,
});

const matchesPermiso = (row: PermisoRow, where?: any): boolean => {
  if (!where) return true;
  const inClaves = where.clave?.in;
  if (Array.isArray(inClaves) && !inClaves.includes(row.clave)) return false;
  if (where.activo !== undefined && row.activo !== where.activo) return false;
  return true;
};

const matchesRolPermiso = (row: MatrizRow, where?: any): boolean => {
  if (!where) return true;
  if (typeof where.permiso === "string" && row.permiso !== where.permiso) return false;
  if (where.alcance?.not && row.alcance === where.alcance.not) return false;
  if (Array.isArray(where.OR)) {
    return where.OR.some(
      (cond: any) =>
        (!cond.rol || cond.rol === row.rol) && (!cond.permiso || cond.permiso === row.permiso)
    );
  }
  return true;
};

const makeDb = (permisosIniciales: PermisoRow[] = [], matrizInicial: MatrizRow[] = []) => {
  const permisos = [...permisosIniciales];
  const matriz = [...matrizInicial];

  const db: any = {
    permiso: {
      findUnique: async ({ where }: any) =>
        permisos.find((p) => p.clave === where.clave) ?? null,
      findMany: async (args: any = {}) =>
        permisos.filter((p) => matchesPermiso(p, args.where)),
      create: async ({ data }: any) => {
        const row: PermisoRow = {
          descripcion: null,
          sensible: false,
          activo: true,
          orden: 0,
          ...data,
        };
        permisos.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = permisos.find((p) => p.clave === where.clave);
        if (!row) throw new Error("permiso no encontrado");
        Object.assign(row, data);
        return row;
      },
    },
    rolPermiso: {
      findMany: async (args: any = {}) => matriz.filter((r) => matchesRolPermiso(r, args.where)),
      upsert: async ({ where, create, update }: any) => {
        const { rol, permiso: clave } = where.rol_permiso;
        let row = matriz.find((r) => r.rol === rol && r.permiso === clave);
        if (!row) {
          row = { rol, permiso: clave, alcance: create.alcance };
          matriz.push(row);
        } else {
          row.alcance = update.alcance;
        }
        return row;
      },
    },
    $transaction: async (cb: any) => cb(db),
  };

  return { db: db as PrismaClient, store: { permisos, matriz } };
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
  resetCatalogo();
  resetMatriz();
});

test.describe("DTO de permisos", () => {
  test("parseAlcances deduplica, ordena canónicamente y valida el subset", () => {
    expect(parseAlcances(["TODO", "NINGUNO", "PROPIO"])).toEqual([
      "NINGUNO",
      "PROPIO",
      "TODO",
    ]);
    expect(capture(() => parseAlcances(["TODO", "TODO"]))?.status).toBe(400);
    expect(capture(() => parseAlcances(["NOPE"]))?.status).toBe(400);
    expect(capture(() => parseAlcances([]))?.status).toBe(400);
    expect(capture(() => parseAlcances("TODO"))?.status).toBe(400);
  });

  test("parseCatalogoCreateBody exige clave modulo.accion y campos obligatorios", () => {
    const ok = parseCatalogoCreateBody({
      clave: "tickets.ver",
      modulo: "Tickets",
      nombre: "Ver tickets",
      alcances: ["TODO"],
    });
    expect(ok.clave).toBe("tickets.ver");
    expect(ok.descripcion).toBeUndefined();
    expect(ok.sensible).toBeUndefined();

    expect(
      capture(() =>
        parseCatalogoCreateBody({ clave: "TicketsVer", modulo: "T", nombre: "N", alcances: ["TODO"] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseCatalogoCreateBody({ clave: "tickets.ver", modulo: "", nombre: "N", alcances: ["TODO"] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseCatalogoCreateBody({ clave: "tickets.ver", modulo: "T", nombre: "N", alcances: [] })
      )?.status
    ).toBe(400);
  });

  test("parseCatalogoUpdateBody exige al menos un campo y admite null en descripcion", () => {
    expect(capture(() => parseCatalogoUpdateBody({}))?.status).toBe(400);
    expect(parseCatalogoUpdateBody({ activo: false })).toEqual({ activo: false });
    expect(parseCatalogoUpdateBody({ descripcion: null })).toEqual({ descripcion: null });
    expect(
      capture(() => parseCatalogoUpdateBody({ sensible: "sí" }))?.status
    ).toBe(400);
  });

  test("parseMatrizBody valida rol, alcance y tamaño del lote", () => {
    const { cambios } = parseMatrizBody({
      cambios: [{ rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" }],
    });
    expect(cambios).toHaveLength(1);

    expect(capture(() => parseMatrizBody({ cambios: [] }))?.status).toBe(400);
    expect(
      capture(() =>
        parseMatrizBody({ cambios: [{ rol: "SUPER", permiso: "a.b", alcance: "TODO" }] })
      )?.status
    ).toBe(400);
    expect(
      capture(() =>
        parseMatrizBody({ cambios: [{ rol: "ADMIN", permiso: "a.b", alcance: "NOPE" }] })
      )?.status
    ).toBe(400);

    const grandes = Array.from({ length: 501 }, () => ({
      rol: "ADMIN",
      permiso: "a.b",
      alcance: "TODO",
    }));
    expect(capture(() => parseMatrizBody({ cambios: grandes }))?.status).toBe(400);
  });
});

test.describe("createCatalogo", () => {
  test("clave duplicada → 409", async () => {
    const { db } = makeDb([permiso({ clave: "tickets.ver" })]);
    const svc = new PermisoService(db);
    const err = await captureAsync(() =>
      svc.createCatalogo(
        { clave: "tickets.ver", modulo: "Tickets", nombre: "Ver", alcances: ["TODO"] },
        "u1"
      )
    );
    expect(err?.status).toBe(409);
  });

  test("crea, audita y recarga la cache", async () => {
    const { db, store } = makeDb();
    const { audit, logs } = makeAudit();
    const svc = new PermisoService(db, audit);

    const creado = await svc.createCatalogo(
      { clave: "tickets.ver", modulo: "Tickets", nombre: "Ver", alcances: ["TODO"], sensible: true },
      "u1"
    );

    expect(creado.clave).toBe("tickets.ver");
    expect(creado.sensible).toBe(true);
    expect(store.permisos).toHaveLength(1);
    expect(logs[0].action).toBe("PERMISO_CATALOGO_CREADO");
    expect(logs[0].entityType).toBe("Permiso");
    expect(logs[0].entityId).toBe("tickets.ver");
    expect(logs[0].userId).toBe("u1");
    expect(esPermiso("tickets.ver")).toBe(true);
  });
});

test.describe("updateCatalogo", () => {
  test("404 si el permiso no existe", async () => {
    const { db } = makeDb();
    const svc = new PermisoService(db);
    const err = await captureAsync(() => svc.updateCatalogo("no.existe", { nombre: "X" }, "u1"));
    expect(err?.status).toBe(404);
  });

  test("narrowing de alcances con concesiones fuera → 409", async () => {
    const { db, store } = makeDb(
      [permiso({ clave: "tickets.ver", alcances: ["PROPIO", "AREA", "TODO"] })],
      [{ rol: "GERENTE", permiso: "tickets.ver", alcance: "AREA" }]
    );
    const svc = new PermisoService(db);

    const err = await captureAsync(() =>
      svc.updateCatalogo("tickets.ver", { alcances: ["PROPIO", "TODO"] }, "u1")
    );

    expect(err?.status).toBe(409);
    expect(store.permisos[0].alcances).toEqual(["PROPIO", "AREA", "TODO"]);
  });

  test("activo=false deja de resolver (fail-closed) y audita antes/después", async () => {
    const { db } = makeDb(
      [permiso({ clave: "tickets.ver", alcances: ["TODO"] })],
      [{ rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" }]
    );
    const { audit, logs } = makeAudit();
    const svc = new PermisoService(db, audit);

    const row = await svc.updateCatalogo("tickets.ver", { activo: false }, "u1");

    expect(row.activo).toBe(false);
    expect(esPermiso("tickets.ver")).toBe(false);
    expect(getMatriz().ADMIN?.["tickets.ver"]).toBeUndefined();
    expect(logs[0].action).toBe("PERMISO_CATALOGO_ACTUALIZADO");
    expect(logs[0].previousState?.activo).toBe(true);
    expect(logs[0].newState?.activo).toBe(false);
  });
});

test.describe("saveMatriz", () => {
  test("rechaza lote vacío y lotes mayores a 500", async () => {
    const { db } = makeDb();
    const svc = new PermisoService(db);
    expect((await captureAsync(() => svc.saveMatriz([], "u1")))?.status).toBe(400);

    const grandes = Array.from({ length: 501 }, () => ({
      rol: "ADMIN" as Role,
      permiso: "a.b",
      alcance: "TODO" as Alcance,
    }));
    expect((await captureAsync(() => svc.saveMatriz(grandes, "u1")))?.status).toBe(400);
  });

  test("valida rol, existencia, actividad y alcance permitido → 400", async () => {
    const { db } = makeDb([
      permiso({ clave: "tickets.ver", alcances: ["PROPIO", "TODO"] }),
      permiso({ clave: "tickets.off", activo: false, alcances: ["TODO"] }),
    ]);
    const svc = new PermisoService(db);

    expect(
      (
        await captureAsync(() =>
          svc.saveMatriz([{ rol: "NOPE" as Role, permiso: "tickets.ver", alcance: "TODO" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatriz([{ rol: "ADMIN", permiso: "no.existe", alcance: "TODO" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatriz([{ rol: "ADMIN", permiso: "tickets.off", alcance: "TODO" }], "u1")
        )
      )?.status
    ).toBe(400);
    expect(
      (
        await captureAsync(() =>
          svc.saveMatriz([{ rol: "ADMIN", permiso: "tickets.ver", alcance: "AREA" }], "u1")
        )
      )?.status
    ).toBe(400);
  });

  test("lockout de ADMIN sobre roles.administrar → 409 y no escribe", async () => {
    const { db, store } = makeDb(
      [permiso({ clave: "roles.administrar", alcances: ["NINGUNO", "TODO"] })],
      [{ rol: "ADMIN", permiso: "roles.administrar", alcance: "TODO" }]
    );
    const svc = new PermisoService(db);

    const err = await captureAsync(() =>
      svc.saveMatriz(
        [{ rol: "ADMIN", permiso: "roles.administrar", alcance: "NINGUNO" }],
        "u1"
      )
    );

    expect(err?.status).toBe(409);
    expect(store.matriz[0].alcance).toBe("TODO");
  });

  test("escribe NINGUNO (tombstone), audita por celda y recarga la cache", async () => {
    const { db, store } = makeDb(
      [permiso({ clave: "tickets.ver", alcances: ["PROPIO", "TODO"] })],
      [{ rol: "EMPLEADO", permiso: "tickets.ver", alcance: "PROPIO" }]
    );
    const { audit, logs } = makeAudit();
    const svc = new PermisoService(db, audit);

    const res = await svc.saveMatriz(
      [{ rol: "EMPLEADO", permiso: "tickets.ver", alcance: "NINGUNO" }],
      "u1"
    );

    expect(res.updated).toBe(1);
    // La fila se conserva con NINGUNO; nunca se borra.
    expect(store.matriz).toHaveLength(1);
    expect(store.matriz[0].alcance).toBe("NINGUNO");
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("PERMISO_MATRIZ_ACTUALIZADA");
    expect(logs[0].entityType).toBe("RolPermiso");
    expect(logs[0].entityId).toBe("EMPLEADO|tickets.ver");
    expect(logs[0].previousState).toEqual({ alcance: "PROPIO" });
    expect(logs[0].newState).toEqual({ alcance: "NINGUNO" });
    // Recarga: NINGUNO no aparece en la matriz efectiva.
    expect(getMatriz().EMPLEADO?.["tickets.ver"]).toBeUndefined();

    // Recarga efectiva: un cambio posterior sí se refleja en la cache.
    await svc.saveMatriz([{ rol: "EMPLEADO", permiso: "tickets.ver", alcance: "TODO" }], "u1");
    expect(getMatriz().EMPLEADO?.["tickets.ver"]).toBe("TODO");
  });
});

test.describe("adminData", () => {
  test("incluye los 6 roles, el catálogo completo (inactivos) y la matriz sin NINGUNO", async () => {
    const { db } = makeDb(
      [
        permiso({ clave: "a.activo", alcances: ["TODO"] }),
        permiso({ clave: "a.inactivo", activo: false, alcances: ["TODO"] }),
      ],
      [
        { rol: "ADMIN", permiso: "a.activo", alcance: "TODO" },
        { rol: "ADMIN", permiso: "a.inactivo", alcance: "NINGUNO" },
      ]
    );
    const svc = new PermisoService(db);

    const data = await svc.adminData();

    expect(data.roles).toHaveLength(6);
    expect(data.catalogo.map((p) => p.clave)).toEqual(["a.activo", "a.inactivo"]);
    expect(data.catalogo.find((p) => p.clave === "a.inactivo")?.activo).toBe(false);
    expect(data.matriz).toEqual([{ rol: "ADMIN", permiso: "a.activo", alcance: "TODO" }]);
  });
});
