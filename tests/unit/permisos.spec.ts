import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import {
  alcanceDe,
  puedeAlgunAlcance,
  permisosDe,
  ticketsVisibles,
  tareasVisibles,
  puedeVerTicket,
  dentroDeAlcance,
  catalogoFromRows,
  setCatalogo,
  resetCatalogo,
  esPermiso,
  clavesDeCatalogo,
  definicionDe,
  matrizFromRows,
  setMatriz,
  getMatriz,
  resetMatriz,
  invalidarMatriz,
  loadPermisosFixture,
  loadRolPermisosFixture,
  type Alcance,
} from "../../src/core/permisos";

/**
 * El catálogo y la matriz ya NO viven en código: estas pruebas los inyectan
 * desde los fixtures con `setCatalogo`/`setMatriz` y verifican el
 * comportamiento fail-closed cuando la cache está vacía.
 */

const usuario = (
  role: Role,
  extra: Partial<{ id: string; departmentId: string | null }> = {}
) => ({
  id: extra.id ?? "user-1",
  role,
  departmentId: extra.departmentId ?? null,
});

/** Carga catálogo y matriz reales desde los fixtures. */
const cargarFixtures = (): void => {
  setCatalogo(catalogoFromRows(loadPermisosFixture()));
  setMatriz(matrizFromRows(loadRolPermisosFixture()));
};

// Cada prueba arranca con las caches vacías (fail-closed).
test.beforeEach(() => {
  resetCatalogo();
  resetMatriz();
});

test.describe("catálogo en memoria", () => {
  test("arranca vacío y deja todo cerrado", () => {
    expect(clavesDeCatalogo()).toEqual([]);
    expect(esPermiso("tickets.ver")).toBe(false);
    expect(alcanceDe(usuario("ADMIN"), "tickets.ver")).toBe("NINGUNO");
    expect(permisosDe(usuario("ADMIN"))).toEqual({});
  });

  test("catalogoFromRows normaliza una fila completa", () => {
    const [def] = catalogoFromRows([
      {
        clave: "tickets.ver",
        modulo: "Tickets",
        nombre: "Ver tickets",
        descripcion: "x",
        alcances: ["PROPIO", "TODO"],
        sensible: true,
        activo: true,
        orden: 3,
      },
    ]);
    expect(def).toEqual({
      clave: "tickets.ver",
      modulo: "Tickets",
      nombre: "Ver tickets",
      descripcion: "x",
      alcances: ["PROPIO", "TODO"],
      sensible: true,
      activo: true,
      orden: 3,
    });
  });

  test("catalogoFromRows aplica defaults y descarta filas inválidas", () => {
    const defs = catalogoFromRows([
      { clave: "a.b", modulo: "M", nombre: "N", alcances: ["TODO"] },
      { clave: "", modulo: "M", nombre: "N", alcances: ["TODO"] },
      { clave: "c.d", modulo: "", nombre: "N", alcances: ["TODO"] },
      { clave: "e.f", modulo: "M", nombre: "", alcances: ["TODO"] },
      { clave: "g.h", modulo: "M", nombre: "N", alcances: [] },
      { clave: "i.j", modulo: "M", nombre: "N", alcances: ["NOPE"] },
      { clave: "k.l", modulo: "M", nombre: "N", alcances: ["TODO"], orden: 2.5 },
    ]);

    expect(defs.map((d) => d.clave)).toEqual(["a.b", "k.l"]);
    expect(defs[0]).toEqual({
      clave: "a.b",
      modulo: "M",
      nombre: "N",
      descripcion: null,
      alcances: ["TODO"],
      sensible: false,
      activo: true,
      orden: 0,
    });
    expect(defs[1].orden).toBe(0);
  });

  test("esPermiso solo reconoce permisos activos", () => {
    setCatalogo(
      catalogoFromRows([
        { clave: "a.activo", modulo: "M", nombre: "N", alcances: ["TODO"], activo: true },
        { clave: "a.inactivo", modulo: "M", nombre: "N", alcances: ["TODO"], activo: false },
      ])
    );

    expect(esPermiso("a.activo")).toBe(true);
    expect(esPermiso("a.inactivo")).toBe(false);
    expect(esPermiso("toString")).toBe(false);
    expect(clavesDeCatalogo()).toEqual(["a.activo"]);
    expect(definicionDe("a.inactivo")?.clave).toBe("a.inactivo");
    expect(definicionDe("no.existe")).toBeUndefined();
  });
});

test.describe("matriz en memoria", () => {
  test("arranca vacía (fail-closed)", () => {
    expect(getMatriz()).toEqual({});
    expect(alcanceDe(usuario("ADMIN"), "tickets.ver")).toBe("NINGUNO");
  });

  test("matrizFromRows ignora claves fuera del catálogo activo", () => {
    setCatalogo(
      catalogoFromRows([
        { clave: "tickets.ver", modulo: "M", nombre: "N", alcances: ["TODO"] },
        { clave: "tickets.cerrar", modulo: "M", nombre: "N", alcances: ["TODO"], activo: false },
      ])
    );

    const matriz = matrizFromRows([
      { rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" },
      { rol: "ADMIN", permiso: "tickets.inexistente", alcance: "TODO" },
      { rol: "ADMIN", permiso: "tickets.cerrar", alcance: "TODO" },
    ]);

    expect(matriz.ADMIN).toEqual({ "tickets.ver": "TODO" });
  });

  test("matrizFromRows acepta un catálogo explícito e ignora NINGUNO", () => {
    const catalogo = catalogoFromRows([
      { clave: "tickets.ver", modulo: "M", nombre: "N", alcances: ["TODO"], activo: true },
      { clave: "tickets.cerrar", modulo: "M", nombre: "N", alcances: ["TODO"], activo: false },
    ]);

    const matriz = matrizFromRows(
      [
        { rol: "EMPLEADO", permiso: "tickets.ver", alcance: "NINGUNO" },
        { rol: "EMPLEADO", permiso: "tickets.ver", alcance: "PROPIO" },
        { rol: "EMPLEADO", permiso: "tickets.cerrar", alcance: "TODO" },
      ],
      catalogo
    );

    expect(matriz.EMPLEADO).toEqual({ "tickets.ver": "PROPIO" });
  });

  test("invalidarMatriz deja la cache vacía", () => {
    cargarFixtures();
    expect(getMatriz().ADMIN?.["tickets.ver"]).toBe("TODO");

    invalidarMatriz();

    expect(getMatriz()).toEqual({});
    expect(alcanceDe(usuario("ADMIN"), "tickets.ver")).toBe("NINGUNO");
  });

  test("resetMatriz deja la cache vacía", () => {
    cargarFixtures();
    expect(getMatriz().ADMIN?.["tickets.ver"]).toBe("TODO");

    resetMatriz();

    expect(getMatriz()).toEqual({});
  });
});

test.describe("resolvedor con catálogo y matriz inyectados", () => {
  test.beforeEach(cargarFixtures);

  test("alcanceDe refleja la matriz de fixtures", () => {
    const empleado = usuario("EMPLEADO");
    expect(alcanceDe(empleado, "tickets.ver")).toBe("PROPIO");
    expect(alcanceDe(empleado, "tickets.crear")).toBe("TODO");
    expect(alcanceDe(empleado, "tickets.cerrar")).toBe("NINGUNO");

    const gerente = usuario("GERENTE");
    expect(alcanceDe(gerente, "tickets.ver")).toBe("AREA");
    expect(alcanceDe(gerente, "tickets.crear")).toBe("TODO");
  });

  test("puedeAlgunAlcance distingue NINGUNO", () => {
    const empleado = usuario("EMPLEADO");
    expect(puedeAlgunAlcance(empleado, "tickets.ver")).toBe(true);
    expect(puedeAlgunAlcance(empleado, "tickets.cerrar")).toBe(false);
  });

  test("permisosDe omite NINGUNO y recorre solo el catálogo activo", () => {
    const empleado = usuario("EMPLEADO");
    expect(permisosDe(empleado)).toEqual({
      "tickets.ver": "PROPIO",
      "tickets.crear": "TODO",
      "tareas.ver": "PROPIO",
    });

    const admin = permisosDe(usuario("ADMIN"));
    expect(Object.keys(admin)).toHaveLength(44);
    expect(Object.values(admin).every((a) => a === "TODO")).toBe(true);
  });

  test("una clave inactiva no aparece en permisosDe aunque tenga fila", () => {
    setCatalogo(
      catalogoFromRows([
        { clave: "tickets.ver", modulo: "M", nombre: "N", alcances: ["TODO"], activo: true },
        { clave: "tickets.cerrar", modulo: "M", nombre: "N", alcances: ["TODO"], activo: false },
      ])
    );
    setMatriz(
      matrizFromRows([
        { rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" },
        { rol: "ADMIN", permiso: "tickets.cerrar", alcance: "TODO" },
      ])
    );

    expect(permisosDe(usuario("ADMIN"))).toEqual({ "tickets.ver": "TODO" });
  });

  test("catálogo vacío ⇒ todo NINGUNO aunque haya matriz", () => {
    resetCatalogo();
    setMatriz({ ADMIN: { "tickets.ver": "TODO" } });

    expect(alcanceDe(usuario("ADMIN"), "tickets.ver")).toBe("NINGUNO");
    expect(permisosDe(usuario("ADMIN"))).toEqual({});
  });
});

test.describe("excepciones (Fase 2, resolvedor)", () => {
  test.beforeEach(cargarFixtures);

  test("una excepción vigente gana sobre el rol", () => {
    const u = {
      ...usuario("EMPLEADO"),
      excepciones: [{ permiso: "tickets.cerrar", alcance: "AREA" as Alcance }],
    };
    expect(alcanceDe(u, "tickets.cerrar")).toBe("AREA");
    expect(permisosDe(u)["tickets.cerrar"]).toBe("AREA");
  });

  test("una excepción puede bajar un permiso del rol a NINGUNO", () => {
    const u = {
      ...usuario("JEFE_DE_AREA"),
      excepciones: [{ permiso: "tareas.asignar", alcance: "NINGUNO" as Alcance }],
    };
    expect(alcanceDe(u, "tareas.asignar")).toBe("NINGUNO");
    expect(permisosDe(u)["tareas.asignar"]).toBeUndefined();
  });

  test("una excepción vencida se ignora", () => {
    const u = {
      ...usuario("EMPLEADO"),
      excepciones: [
        {
          permiso: "tickets.cerrar",
          alcance: "TODO" as Alcance,
          venceEn: new Date(Date.now() - 1000),
        },
      ],
    };
    expect(alcanceDe(u, "tickets.cerrar")).toBe("NINGUNO");
  });

  test("una excepción sin vencimiento se considera vigente", () => {
    const u = {
      ...usuario("EMPLEADO"),
      excepciones: [{ permiso: "tickets.cerrar", alcance: "TODO" as Alcance, venceEn: null }],
    };
    expect(alcanceDe(u, "tickets.cerrar")).toBe("TODO");
  });
});

test.describe("alcance por registro", () => {
  test.beforeEach(cargarFixtures);

  test("dentroDeAlcance: NINGUNO y TODO", () => {
    const u = usuario("EMPLEADO", { id: "u1" });
    const ajeno = { creadoPorId: "otro", asignadoAId: null, departmentId: "d2" };
    expect(dentroDeAlcance(u, "NINGUNO", ajeno)).toBe(false);
    expect(dentroDeAlcance(u, "TODO", ajeno)).toBe(true);
  });

  test("dentroDeAlcance: PROPIO reconoce creador, responsable y tarea", () => {
    const u = usuario("EMPLEADO", { id: "u1" });
    expect(dentroDeAlcance(u, "PROPIO", { creadoPorId: "u1" })).toBe(true);
    expect(dentroDeAlcance(u, "PROPIO", { creadoPorId: "x", asignadoAId: "u1" })).toBe(true);
    expect(
      dentroDeAlcance(u, "PROPIO", { creadoPorId: "x", assignments: [{ userId: "u1" }] })
    ).toBe(true);
    expect(dentroDeAlcance(u, "PROPIO", { creadoPorId: "x", departmentId: "d1" })).toBe(false);
  });

  test("dentroDeAlcance: AREA incluye lo propio y su departamento", () => {
    const u = usuario("JEFE_DE_AREA", { id: "u1", departmentId: "d1" });
    expect(dentroDeAlcance(u, "AREA", { creadoPorId: "x", departmentId: "d1" })).toBe(true);
    expect(dentroDeAlcance(u, "AREA", { creadoPorId: "u1", departmentId: "d9" })).toBe(true);
    expect(dentroDeAlcance(u, "AREA", { creadoPorId: "x", departmentId: "d9" })).toBe(false);
  });

  test("dentroDeAlcance: AREA sin departamento se comporta como PROPIO", () => {
    const u = usuario("JEFE_DE_AREA", { id: "u1", departmentId: null });
    expect(dentroDeAlcance(u, "AREA", { creadoPorId: "x", departmentId: "d1" })).toBe(false);
    expect(dentroDeAlcance(u, "AREA", { creadoPorId: "u1", departmentId: "d9" })).toBe(true);
  });

  test("puedeVerTicket usa el alcance de tickets.ver", () => {
    const jefe = usuario("JEFE_DE_AREA", { id: "u1", departmentId: "d1" });
    expect(puedeVerTicket(jefe, { creadoPorId: "x", departmentId: "d1" })).toBe(true);
    expect(puedeVerTicket(jefe, { creadoPorId: "x", departmentId: "d2" })).toBe(false);
  });
});

test.describe("ticketsVisibles / tareasVisibles", () => {
  test.beforeEach(cargarFixtures);

  test("TODO no filtra", () => {
    expect(ticketsVisibles(usuario("ADMIN"))).toEqual({});
  });

  test("NINGUNO no devuelve nada", () => {
    expect(ticketsVisibles(usuario("EMPLEADO"), "tickets.cerrar")).toEqual({ OR: [] });
  });

  test("PROPIO filtra por creador, responsable o tarea asignada", () => {
    const where = ticketsVisibles(usuario("EMPLEADO", { id: "u1", departmentId: "d1" }));
    expect(where).toEqual({
      OR: [
        { creadoPorId: "u1" },
        { asignadoAId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });

  test("AREA con departamento agrega el filtro de área", () => {
    const where = ticketsVisibles(usuario("JEFE_DE_AREA", { id: "u1", departmentId: "d1" }));
    expect(where).toEqual({
      OR: [
        { creadoPorId: "u1" },
        { asignadoAId: "u1" },
        { assignments: { some: { userId: "u1" } } },
        { departmentId: "d1" },
      ],
    });
  });

  test("AREA sin departamento se comporta como PROPIO", () => {
    const where = ticketsVisibles(usuario("JEFE_DE_AREA", { id: "u1", departmentId: null }));
    expect(where).toEqual({
      OR: [
        { creadoPorId: "u1" },
        { asignadoAId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });

  test("tareasVisibles usa el alcance de tareas.ver", () => {
    expect(tareasVisibles(usuario("ADMIN"))).toEqual({});
    expect(tareasVisibles(usuario("GUARD", { id: "u1" }))).toEqual({
      OR: [
        { creadoPorId: "u1" },
        { asignadoAId: "u1" },
        { assignments: { some: { userId: "u1" } } },
      ],
    });
  });
});
