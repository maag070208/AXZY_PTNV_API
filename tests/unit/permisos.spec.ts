import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import {
  PERMISOS,
  PERMISO_KEYS,
  esPermiso,
  ROLES_BASE,
  DESVIACIONES_MATRIZ,
  ENFORCEMENT_PENDIENTE,
  alcanceDe,
  puedeAlgunAlcance,
  permisosDe,
  ticketsVisibles,
  tareasVisibles,
  puedeVerTicket,
  dentroDeAlcance,
  matrizFromRows,
  filasMatrizPorDefecto,
  getMatriz,
  setMatriz,
  resetMatriz,
  type Alcance,
  type MatrizRoles,
  type Permiso,
} from "../../src/core/permisos";

const ROLES: readonly Role[] = [
  "ADMIN",
  "GERENTE",
  "JEFE_DE_AREA",
  "EMPLEADO",
  "RECURSOS_HUMANOS",
  "GUARD",
];

/**
 * Snapshot congelado de la matriz de Fase 1 (ROLES_Y_PERMISOS.md §3 con las
 * desviaciones decididas). Solo se listan los alcances distintos de NINGUNO;
 * la ausencia de clave = NINGUNO. Este literal es independiente de
 * `ROLES_BASE` a propósito: si la implementación cambia sin actualizar la
 * matriz esperada, la prueba falla.
 */
const MATRIZ_ESPERADA: Record<Role, Partial<Record<Permiso, Alcance>>> = {
  ADMIN: Object.fromEntries(PERMISO_KEYS.map((k) => [k, "TODO"])) as Record<Permiso, Alcance>,

  GERENTE: {
    "tickets.ver": "AREA",
    "tickets.crear": "TODO",
    "tickets.editar": "AREA",
    "tickets.cerrar": "AREA",
    "tareas.ver": "AREA",
    "tareas.asignar": "PROPIO",
    "tareas.completar": "AREA",
    "dispositivos.ver": "TODO",
    "dispositivos.crear": "TODO",
    "dispositivos.editar": "TODO",
    "dispositivos.eliminar": "TODO",
    "prestamos.ver": "TODO",
    "prestamos.crear": "TODO",
    "prestamos.editar": "TODO",
    "prestamos.eliminar": "TODO",
    "salidas.registrar": "TODO",
    "reportes.ver": "TODO",
    "reportes.exportar": "TODO",
    "personal.expediente": "TODO",
    "personal.actas": "TODO",
    "usuarios.permisos": "AREA",
    "catalogos.administrar": "TODO",
    "acceso.escanear": "TODO",
    "acceso.bitacora": "TODO",
    "acceso.anular": "TODO",
    "acceso.sitios": "TODO",
    "checador.ver": "TODO",
    "checador.sincronizar": "TODO",
    "horarios.ver": "TODO",
    "horas_extra.ver": "TODO",
    "horas_extra.aprobar": "TODO",
    "panel.ver": "TODO",
  },

  JEFE_DE_AREA: {
    "tickets.ver": "AREA",
    "tickets.crear": "TODO",
    "tickets.editar": "PROPIO",
    "tickets.cerrar": "AREA",
    "tareas.ver": "AREA",
    "tareas.asignar": "PROPIO",
  },

  EMPLEADO: {
    "tickets.ver": "PROPIO",
    "tickets.crear": "TODO",
    "tareas.ver": "PROPIO",
  },

  RECURSOS_HUMANOS: {
    "tickets.ver": "PROPIO",
    "tickets.crear": "TODO",
    "tareas.ver": "PROPIO",
    "tareas.asignar": "PROPIO",
    "personal.expediente": "TODO",
    "personal.actas": "TODO",
    "acceso.bitacora": "TODO",
    "acceso.anular": "TODO",
    "checador.ver": "TODO",
    "checador.sincronizar": "TODO",
    "checador.vincular": "TODO",
    "horarios.ver": "TODO",
    "horarios.administrar": "TODO",
    "horas_extra.ver": "TODO",
  },

  GUARD: {
    "tickets.ver": "PROPIO",
    "tickets.crear": "TODO",
    "tareas.ver": "PROPIO",
    "tareas.asignar": "PROPIO",
    "acceso.escanear": "TODO",
  },
};

const usuario = (role: Role, extra: Partial<{ id: string; departmentId: string | null }> = {}) => ({
  id: extra.id ?? "user-1",
  role,
  departmentId: extra.departmentId ?? null,
});

test.describe("catálogo de permisos", () => {
  test("contiene todas las claves de la matriz §3", () => {
    const esperadas: Permiso[] = [
      "tickets.ver", "tickets.crear", "tickets.editar", "tickets.cerrar", "tickets.eliminar",
      "tareas.ver", "tareas.asignar", "tareas.completar",
      "dispositivos.ver", "dispositivos.crear", "dispositivos.editar", "dispositivos.eliminar",
      "prestamos.ver", "prestamos.crear", "prestamos.editar", "prestamos.eliminar",
      "salidas.registrar",
      "reportes.ver", "reportes.exportar",
      "personal.expediente", "personal.actas",
      "usuarios.ver", "usuarios.crear", "usuarios.editar", "usuarios.eliminar", "usuarios.permisos",
      "departamentos.administrar", "catalogos.administrar",
      "acceso.escanear", "acceso.bitacora", "acceso.anular", "acceso.sitios",
      "checador.ver", "checador.sincronizar", "checador.vincular", "relojes.administrar",
      "horarios.ver", "horarios.administrar", "horas_extra.ver", "horas_extra.aprobar",
      "panel.ver", "auditoria.ver", "sistema.configurar",
    ];
    expect([...PERMISO_KEYS].sort()).toEqual([...esperadas].sort());
  });

  test("asigna los alcances válidos según §3", () => {
    const porRegistro: Permiso[] = [
      "tickets.ver", "tickets.editar", "tickets.cerrar",
      "tareas.ver", "tareas.asignar", "tareas.completar",
    ];
    const porArea: Permiso[] = [
      "usuarios.permisos", "acceso.bitacora", "checador.ver", "horas_extra.ver", "horas_extra.aprobar",
    ];

    for (const permiso of PERMISO_KEYS) {
      const alcances = PERMISOS[permiso].alcances;
      if (porRegistro.includes(permiso)) {
        expect(alcances, permiso).toEqual(["PROPIO", "AREA", "TODO"]);
      } else if (porArea.includes(permiso)) {
        expect(alcances, permiso).toEqual(["AREA", "TODO"]);
      } else {
        expect(alcances, permiso).toEqual(["NINGUNO", "TODO"]);
      }
    }
  });

  test("marca como sensibles los permisos con candado", () => {
    const sensibles: Permiso[] = [
      "usuarios.permisos", "relojes.administrar", "auditoria.ver", "sistema.configurar",
    ];
    for (const permiso of PERMISO_KEYS) {
      expect(PERMISOS[permiso].sensible ?? false, permiso).toBe(sensibles.includes(permiso));
    }
  });

  test("esPermiso reconoce solo claves del catálogo", () => {
    expect(esPermiso("tickets.ver")).toBe(true);
    expect(esPermiso("tickets.inexistente")).toBe(false);
    expect(esPermiso("toString")).toBe(false);
  });
});

test.describe("matriz de roles base (defaults para la seed)", () => {
  for (const role of ROLES) {
    test(`alcanceDe de ${role} coincide con el snapshot congelado`, () => {
      const u = usuario(role, { departmentId: "dept-1" });
      for (const permiso of PERMISO_KEYS) {
        const esperado = MATRIZ_ESPERADA[role][permiso] ?? "NINGUNO";
        expect(alcanceDe(u, permiso), `${role} / ${permiso}`).toBe(esperado);
      }
    });
  }

  test("ROLES_BASE coincide exactamente con el snapshot (defaults de la seed)", () => {
    for (const role of ROLES) {
      const base = ROLES_BASE[role] ?? {};
      const claves = Object.keys(base) as Permiso[];
      for (const permiso of claves) {
        expect(base[permiso], `${role} / ${permiso}`).not.toBe("NINGUNO");
      }
      for (const permiso of PERMISO_KEYS) {
        expect(base[permiso] ?? "NINGUNO", `${role} / ${permiso}`).toBe(
          MATRIZ_ESPERADA[role][permiso] ?? "NINGUNO"
        );
      }
    }
  });
});

test.describe("desviaciones y enforcement pendiente", () => {
  const DESVIACIONES_ESPERADAS = [
    { permiso: "usuarios.ver", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.crear", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.editar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.eliminar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.ver", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.crear", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.editar", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "usuarios.eliminar", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
    { permiso: "departamentos.administrar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§7.3" },
    { permiso: "auditoria.ver", rol: "GERENTE", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§7.3 / §3" },
    { permiso: "sistema.configurar", rol: "GERENTE", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§7.3 / §3" },
    { permiso: "usuarios.permisos", rol: "GERENTE", diseno: "AREA", fase1: "AREA", ref: "§11.2 (se conserva; no se enforcea en Fase 1)" },
    { permiso: "panel.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },
    { permiso: "reportes.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },
    { permiso: "reportes.exportar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },
    { permiso: "dispositivos.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "dispositivos.crear", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "dispositivos.editar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "dispositivos.eliminar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "prestamos.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "prestamos.crear", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "prestamos.editar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "prestamos.eliminar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
    { permiso: "checador.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
    { permiso: "checador.sincronizar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
    { permiso: "horarios.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
  ] as const;

  test("DESVIACIONES_MATRIZ coincide exactamente con lo documentado", () => {
    expect(DESVIACIONES_MATRIZ).toEqual(DESVIACIONES_ESPERADAS);
  });

  test("cada desviación refleja el alcance realmente implementado", () => {
    for (const d of DESVIACIONES_MATRIZ) {
      const implementado = ROLES_BASE[d.rol]?.[d.permiso] ?? "NINGUNO";
      expect(implementado, `${d.rol} / ${d.permiso}`).toBe(d.fase1);
    }
  });

  test("ENFORCEMENT_PENDIENTE es la lista esperada", () => {
    expect(ENFORCEMENT_PENDIENTE).toEqual(["dispositivos.ver", "prestamos.ver"]);
  });
});

test.describe("permisosDe", () => {
  for (const role of ROLES) {
    test(`${role}: omite los alcances NINGUNO`, () => {
      const u = usuario(role, { departmentId: "dept-1" });
      const permisos = permisosDe(u);
      const esperados = PERMISO_KEYS.filter(
        (p) => (MATRIZ_ESPERADA[role][p] ?? "NINGUNO") !== "NINGUNO"
      );
      expect(Object.keys(permisos).sort()).toEqual([...esperados].sort());
      for (const [permiso, alcance] of Object.entries(permisos)) {
        expect(alcance).not.toBe("NINGUNO");
        expect(alcance).toBe(alcanceDe(u, permiso as Permiso));
      }
    });
  }

  test("puedeAlgunAlcance distingue NINGUNO", () => {
    const empleado = usuario("EMPLEADO");
    expect(puedeAlgunAlcance(empleado, "tickets.ver")).toBe(true);
    expect(puedeAlgunAlcance(empleado, "tickets.cerrar")).toBe(false);
  });
});

test.describe("excepciones (Fase 2, resolvedor)", () => {
  test("una excepción vigente gana sobre el rol", () => {
    const u = usuario("EMPLEADO");
    const conExcepcion = {
      ...u,
      excepciones: [{ permiso: "tickets.cerrar", alcance: "AREA" as Alcance }],
    };
    expect(alcanceDe(conExcepcion, "tickets.cerrar")).toBe("AREA");
    expect(permisosDe(conExcepcion)["tickets.cerrar"]).toBe("AREA");
  });

  test("una excepción puede bajar un permiso del rol a NINGUNO", () => {
    const u = usuario("JEFE_DE_AREA");
    const conExcepcion = {
      ...u,
      excepciones: [{ permiso: "tareas.asignar", alcance: "NINGUNO" as Alcance }],
    };
    expect(alcanceDe(conExcepcion, "tareas.asignar")).toBe("NINGUNO");
    expect(permisosDe(conExcepcion)["tareas.asignar"]).toBeUndefined();
  });

  test("una excepción vencida se ignora", () => {
    const u = usuario("EMPLEADO");
    const vencida = {
      ...u,
      excepciones: [
        { permiso: "tickets.cerrar", alcance: "TODO" as Alcance, venceEn: new Date(Date.now() - 1000) },
      ],
    };
    expect(alcanceDe(vencida, "tickets.cerrar")).toBe("NINGUNO");
  });

  test("una excepción sin vencimiento se considera vigente", () => {
    const u = usuario("EMPLEADO");
    const sinVencimiento = {
      ...u,
      excepciones: [{ permiso: "tickets.cerrar", alcance: "TODO" as Alcance, venceEn: null }],
    };
    expect(alcanceDe(sinVencimiento, "tickets.cerrar")).toBe("TODO");
  });
});

test.describe("alcance por registro", () => {
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
    expect(dentroDeAlcance(u, "PROPIO", { creadoPorId: "x", assignments: [{ userId: "u1" }] })).toBe(true);
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

test.describe("matriz en base (cache + seed)", () => {
  // Cada prueba que inyecta una matriz deja la cache como estaba.
  test.afterEach(resetMatriz);

  test("matrizFromRows construye el mapa desde las filas", () => {
    const matriz = matrizFromRows([
      { rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" },
      { rol: "EMPLEADO", permiso: "tickets.ver", alcance: "PROPIO" },
      { rol: "EMPLEADO", permiso: "tickets.crear", alcance: "TODO" },
    ]);

    expect(matriz.ADMIN["tickets.ver"]).toBe("TODO");
    expect(matriz.EMPLEADO["tickets.ver"]).toBe("PROPIO");
    expect(matriz.EMPLEADO["tickets.crear"]).toBe("TODO");
    // Roles sin filas quedan vacíos (todo NINGUNO).
    expect(matriz.GERENTE).toEqual({});
  });

  test("matrizFromRows ignora claves fuera del catálogo", () => {
    const matriz = matrizFromRows([
      { rol: "ADMIN", permiso: "tickets.inexistente", alcance: "TODO" },
      { rol: "ADMIN", permiso: "tickets.ver", alcance: "TODO" },
    ]);

    expect(Object.keys(matriz.ADMIN)).toEqual(["tickets.ver"]);
  });

  test("matrizFromRows ignora las filas NINGUNO", () => {
    const matriz = matrizFromRows([
      { rol: "EMPLEADO", permiso: "tickets.ver", alcance: "NINGUNO" },
      { rol: "EMPLEADO", permiso: "tickets.crear", alcance: "TODO" },
    ]);

    expect(matriz.EMPLEADO["tickets.ver"]).toBeUndefined();
    expect(matriz.EMPLEADO["tickets.crear"]).toBe("TODO");
  });

  test("filasMatrizPorDefecto cubre exactamente los pares ≠ NINGUNO de ROLES_BASE", () => {
    const esperadas = new Set<string>();
    for (const role of ROLES) {
      for (const [permiso, alcance] of Object.entries(ROLES_BASE[role] ?? {})) {
        if (alcance && alcance !== "NINGUNO") esperadas.add(`${role}|${permiso}`);
      }
    }

    const filas = filasMatrizPorDefecto();
    expect(new Set(filas.map((f) => `${f.rol}|${f.permiso}`))).toEqual(esperadas);
    expect(filas.some((f) => f.alcance === "NINGUNO")).toBe(false);
  });

  test("setMatriz inyecta la matriz que lee el resolvedor", () => {
    const custom: MatrizRoles = {
      ...ROLES_BASE,
      EMPLEADO: { "tickets.ver": "AREA", "tareas.ver": "PROPIO" },
    };
    setMatriz(custom);

    const empleado = usuario("EMPLEADO");
    expect(alcanceDe(empleado, "tickets.ver")).toBe("AREA");
    expect(alcanceDe(empleado, "tareas.ver")).toBe("PROPIO");
    expect(alcanceDe(empleado, "tickets.crear")).toBe("NINGUNO");
    expect(permisosDe(empleado)).toEqual({ "tickets.ver": "AREA", "tareas.ver": "PROPIO" });
  });

  test("getMatriz recién reseteado equivale a ROLES_BASE", () => {
    resetMatriz();
    expect(getMatriz()).toEqual(ROLES_BASE);
  });
});
