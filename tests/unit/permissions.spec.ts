import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import {
  scopeOf,
  canAnyScope,
  permissionsOf,
  visibleTickets,
  visibleTasks,
  canViewTicket,
  withinScope,
  catalogFromRows,
  setCatalog,
  resetCatalog,
  isPermission,
  catalogKeys,
  definitionOf,
  matrixFromRows,
  setMatrix,
  getMatrix,
  resetMatrix,
  invalidateMatrix,
  loadPermissionsFixture,
  loadRolePermissionsFixture,
  type PermissionScope,
} from "../../src/core/permissions";

/**
 * El catálogo y la matriz ya NO viven en código: estas pruebas los inyectan
 * desde los fixtures con `setCatalogo`/`setMatriz` y verifican el
 * comportamiento fail-closed cuando la cache está vacía.
 */

const user = (
  role: Role,
  extra: Partial<{ id: string; departmentId: string | null }> = {}
) => ({
  id: extra.id ?? "user-1",
  role,
  departmentId: extra.departmentId ?? null,
});

/** Carga catálogo y matriz reales desde los fixtures. */
const loadFixtures = (): void => {
  setCatalog(catalogFromRows(loadPermissionsFixture()));
  setMatrix(matrixFromRows(loadRolePermissionsFixture()));
};

// Cada prueba arranca con las caches vacías (fail-closed).
test.beforeEach(() => {
  resetCatalog();
  resetMatrix();
});

test.describe("catálogo en memoria", () => {
  test("arranca vacío y deja todo cerrado", () => {
    expect(catalogKeys()).toEqual([]);
    expect(isPermission("tickets.view")).toBe(false);
    expect(scopeOf(user("ADMIN"), "tickets.view")).toBe("NONE");
    expect(permissionsOf(user("ADMIN"))).toEqual({});
  });

  test("catalogoFromRows normaliza una fila completa", () => {
    const [def] = catalogFromRows([
      {
        key: "tickets.view",
        module: "Tickets",
        name: "Ver tickets",
        description: "x",
        scopes: ["OWN", "ALL"],
        sensitive: true,
        active: true,
        sortOrder: 3,
      },
    ]);
    expect(def).toEqual({
      key: "tickets.view",
      module: "Tickets",
      name: "Ver tickets",
      description: "x",
      scopes: ["OWN", "ALL"],
      sensitive: true,
      active: true,
      sortOrder: 3,
    });
  });

  test("catalogoFromRows aplica defaults y descarta filas inválidas", () => {
    const defs = catalogFromRows([
      { key: "a.b", module: "M", name: "N", scopes: ["ALL"] },
      { key: "", module: "M", name: "N", scopes: ["ALL"] },
      { key: "c.d", module: "", name: "N", scopes: ["ALL"] },
      { key: "e.f", module: "M", name: "", scopes: ["ALL"] },
      { key: "g.h", module: "M", name: "N", scopes: [] },
      { key: "i.j", module: "M", name: "N", scopes: ["NOPE"] },
      { key: "k.l", module: "M", name: "N", scopes: ["ALL"], sortOrder: 2.5 },
    ]);

    expect(defs.map((d) => d.key)).toEqual(["a.b", "k.l"]);
    expect(defs[0]).toEqual({
      key: "a.b",
      module: "M",
      name: "N",
      description: null,
      scopes: ["ALL"],
      sensitive: false,
      active: true,
      sortOrder: 0,
    });
    expect(defs[1].sortOrder).toBe(0);
  });

  test("esPermiso solo reconoce permisos activos", () => {
    setCatalog(
      catalogFromRows([
        { key: "a.active", module: "M", name: "N", scopes: ["ALL"], active: true },
        { key: "a.inactive", module: "M", name: "N", scopes: ["ALL"], active: false },
      ])
    );

    expect(isPermission("a.active")).toBe(true);
    expect(isPermission("a.inactive")).toBe(false);
    expect(isPermission("toString")).toBe(false);
    expect(catalogKeys()).toEqual(["a.active"]);
    expect(definitionOf("a.inactive")?.key).toBe("a.inactive");
    expect(definitionOf("no.existe")).toBeUndefined();
  });
});

test.describe("matriz en memoria", () => {
  test("arranca vacía (fail-closed)", () => {
    expect(getMatrix()).toEqual({});
    expect(scopeOf(user("ADMIN"), "tickets.view")).toBe("NONE");
  });

  test("matrizFromRows ignora claves fuera del catálogo activo", () => {
    setCatalog(
      catalogFromRows([
        { key: "tickets.view", module: "M", name: "N", scopes: ["ALL"] },
        { key: "tickets.close", module: "M", name: "N", scopes: ["ALL"], active: false },
      ])
    );

    const matrix = matrixFromRows([
      { role: "ADMIN", permission: "tickets.view", scope: "ALL" },
      { role: "ADMIN", permission: "tickets.nonexistent", scope: "ALL" },
      { role: "ADMIN", permission: "tickets.close", scope: "ALL" },
    ]);

    expect(matrix.ADMIN).toEqual({ "tickets.view": "ALL" });
  });

  test("matrizFromRows acepta un catálogo explícito e ignora NINGUNO", () => {
    const catalog = catalogFromRows([
      { key: "tickets.view", module: "M", name: "N", scopes: ["ALL"], active: true },
      { key: "tickets.close", module: "M", name: "N", scopes: ["ALL"], active: false },
    ]);

    const matrix = matrixFromRows(
      [
        { role: "EMPLOYEE", permission: "tickets.view", scope: "NONE" },
        { role: "EMPLOYEE", permission: "tickets.view", scope: "OWN" },
        { role: "EMPLOYEE", permission: "tickets.close", scope: "ALL" },
      ],
      catalog
    );

    expect(matrix.EMPLOYEE).toEqual({ "tickets.view": "OWN" });
  });

  test("invalidarMatriz deja la cache vacía", () => {
    loadFixtures();
    expect(getMatrix().ADMIN?.["tickets.view"]).toBe("ALL");

    invalidateMatrix();

    expect(getMatrix()).toEqual({});
    expect(scopeOf(user("ADMIN"), "tickets.view")).toBe("NONE");
  });

  test("resetMatriz deja la cache vacía", () => {
    loadFixtures();
    expect(getMatrix().ADMIN?.["tickets.view"]).toBe("ALL");

    resetMatrix();

    expect(getMatrix()).toEqual({});
  });
});

test.describe("resolvedor con catálogo y matriz inyectados", () => {
  test.beforeEach(loadFixtures);

  test("alcanceDe refleja la matriz de fixtures", () => {
    const employee = user("EMPLOYEE");
    expect(scopeOf(employee, "tickets.view")).toBe("OWN");
    expect(scopeOf(employee, "tickets.create")).toBe("ALL");
    expect(scopeOf(employee, "tickets.close")).toBe("NONE");

    const manager = user("MANAGER");
    expect(scopeOf(manager, "tickets.view")).toBe("AREA");
    expect(scopeOf(manager, "tickets.create")).toBe("ALL");
  });

  test("puedeAlgunAlcance distingue NINGUNO", () => {
    const employee = user("EMPLOYEE");
    expect(canAnyScope(employee, "tickets.view")).toBe(true);
    expect(canAnyScope(employee, "tickets.close")).toBe(false);
  });

  test("permisosDe omite NINGUNO y recorre solo el catálogo activo", () => {
    const employee = user("EMPLOYEE");
    expect(permissionsOf(employee)).toEqual({
      "tickets.view": "OWN",
      "tickets.create": "ALL",
      "tasks.view": "OWN",
    });

    const admin = permissionsOf(user("ADMIN"));
    expect(Object.keys(admin)).toHaveLength(44);
    expect(Object.values(admin).every((a) => a === "ALL")).toBe(true);
  });

  test("una clave inactiva no aparece en permisosDe aunque tenga fila", () => {
    setCatalog(
      catalogFromRows([
        { key: "tickets.view", module: "M", name: "N", scopes: ["ALL"], active: true },
        { key: "tickets.close", module: "M", name: "N", scopes: ["ALL"], active: false },
      ])
    );
    setMatrix(
      matrixFromRows([
        { role: "ADMIN", permission: "tickets.view", scope: "ALL" },
        { role: "ADMIN", permission: "tickets.close", scope: "ALL" },
      ])
    );

    expect(permissionsOf(user("ADMIN"))).toEqual({ "tickets.view": "ALL" });
  });

  test("catálogo vacío ⇒ todo NINGUNO aunque haya matriz", () => {
    resetCatalog();
    setMatrix({ ADMIN: { "tickets.view": "ALL" } });

    expect(scopeOf(user("ADMIN"), "tickets.view")).toBe("NONE");
    expect(permissionsOf(user("ADMIN"))).toEqual({});
  });
});

test.describe("excepciones (Fase 2, resolvedor)", () => {
  test.beforeEach(loadFixtures);

  test("una excepción vigente gana sobre el rol", () => {
    const u = {
      ...user("EMPLOYEE"),
      exceptions: [{ permission: "tickets.close", scope: "AREA" as PermissionScope }],
    };
    expect(scopeOf(u, "tickets.close")).toBe("AREA");
    expect(permissionsOf(u)["tickets.close"]).toBe("AREA");
  });

  test("una excepción puede bajar un permiso del rol a NINGUNO", () => {
    const u = {
      ...user("AREA_HEAD"),
      exceptions: [{ permission: "tasks.assign", scope: "NONE" as PermissionScope }],
    };
    expect(scopeOf(u, "tasks.assign")).toBe("NONE");
    expect(permissionsOf(u)["tasks.assign"]).toBeUndefined();
  });

  test("una excepción vencida se ignora", () => {
    const u = {
      ...user("EMPLOYEE"),
      exceptions: [
        {
          permission: "tickets.close",
          scope: "ALL" as PermissionScope,
          expiresAt: new Date(Date.now() - 1000),
        },
      ],
    };
    expect(scopeOf(u, "tickets.close")).toBe("NONE");
  });

  test("una excepción sin vencimiento se considera vigente", () => {
    const u = {
      ...user("EMPLOYEE"),
      exceptions: [{ permission: "tickets.close", scope: "ALL" as PermissionScope, expiresAt: null }],
    };
    expect(scopeOf(u, "tickets.close")).toBe("ALL");
  });
});

test.describe("alcance por registro", () => {
  test.beforeEach(loadFixtures);

  test("dentroDeAlcance: NINGUNO y TODO", () => {
    const u = user("EMPLOYEE", { id: "u1" });
    const others = { createdById: "other", assignedToId: null, departmentId: "d2" };
    expect(withinScope(u, "NONE", others)).toBe(false);
    expect(withinScope(u, "ALL", others)).toBe(true);
  });

  test("dentroDeAlcance: PROPIO reconoce creador, responsable y tarea", () => {
    const u = user("EMPLOYEE", { id: "u1" });
    expect(withinScope(u, "OWN", { createdById: "u1" })).toBe(true);
    expect(withinScope(u, "OWN", { createdById: "x", assignedToId: "u1" })).toBe(true);
    expect(
      withinScope(u, "OWN", { createdById: "x", assignments: [{ userId: "u1" }] })
    ).toBe(true);
    expect(withinScope(u, "OWN", { createdById: "x", departmentId: "d1" })).toBe(false);
  });

  test("dentroDeAlcance: AREA incluye lo propio y su departamento", () => {
    const u = user("AREA_HEAD", { id: "u1", departmentId: "d1" });
    expect(withinScope(u, "AREA", { createdById: "x", departmentId: "d1" })).toBe(true);
    expect(withinScope(u, "AREA", { createdById: "u1", departmentId: "d9" })).toBe(true);
    expect(withinScope(u, "AREA", { createdById: "x", departmentId: "d9" })).toBe(false);
  });

  test("dentroDeAlcance: AREA sin departamento se comporta como PROPIO", () => {
    const u = user("AREA_HEAD", { id: "u1", departmentId: null });
    expect(withinScope(u, "AREA", { createdById: "x", departmentId: "d1" })).toBe(false);
    expect(withinScope(u, "AREA", { createdById: "u1", departmentId: "d9" })).toBe(true);
  });

  test("puedeVerTicket usa el alcance de tickets.ver", () => {
    const head = user("AREA_HEAD", { id: "u1", departmentId: "d1" });
    expect(canViewTicket(head, { createdById: "x", departmentId: "d1" })).toBe(true);
    expect(canViewTicket(head, { createdById: "x", departmentId: "d2" })).toBe(false);
  });
});

test.describe("ticketsVisibles / tareasVisibles", () => {
  test.beforeEach(loadFixtures);

  test("TODO no filtra", () => {
    expect(visibleTickets(user("ADMIN"))).toEqual({});
  });

  test("NINGUNO no devuelve nada", () => {
    expect(visibleTickets(user("EMPLOYEE"), "tickets.close")).toEqual({ OR: [] });
  });

  test("PROPIO filtra por creador, responsable o tarea asignada", () => {
    const where = visibleTickets(user("EMPLOYEE", { id: "u1", departmentId: "d1" }));
    expect(where).toEqual({
      OR: [
        { createdById: "u1" },
        { assignedToId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });

  test("AREA con departamento agrega el filtro de área", () => {
    const where = visibleTickets(user("AREA_HEAD", { id: "u1", departmentId: "d1" }));
    expect(where).toEqual({
      OR: [
        { createdById: "u1" },
        { assignedToId: "u1" },
        { assignments: { some: { userId: "u1" } } },
        { departmentId: "d1" },
      ],
    });
  });

  test("AREA sin departamento se comporta como PROPIO", () => {
    const where = visibleTickets(user("AREA_HEAD", { id: "u1", departmentId: null }));
    expect(where).toEqual({
      OR: [
        { createdById: "u1" },
        { assignedToId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });

  test("tareasVisibles usa el alcance de tareas.ver", () => {
    expect(visibleTasks(user("ADMIN"))).toEqual({});
    expect(visibleTasks(user("GUARD", { id: "u1" }))).toEqual({
      OR: [
        { createdById: "u1" },
        { assignedToId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });
});
