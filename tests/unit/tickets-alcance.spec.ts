import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import {
  alcanceDe,
  dentroDeAlcance,
  puedeVerTicket,
  ticketsVisibles,
  type RecursoAlcanzable,
  type UsuarioPermisos,
} from "../../src/core/permisos";

/**
 * Fija la equivalencia entre las funciones de alcance de `@core/permisos` y la
 * autorización que el dominio de tickets tenía embebida antes del refactor
 * (`ticketAccessWhere` / `assertTicketAccess`). Las implementaciones de abajo
 * son una copia congelada del código anterior: si el refactor cambia el
 * resultado por rol, esta prueba falla. Sin BD.
 */

const ROLES: readonly Role[] = [
  "ADMIN",
  "GERENTE",
  "JEFE_DE_AREA",
  "EMPLEADO",
  "RECURSOS_HUMANOS",
  "GUARD",
];

const ID = "user-1";
const DEPT = "dept-1";
const OTRO = "user-2";
const OTRO_DEPT = "dept-2";

const usuario = (role: Role, extra: Partial<{ id: string; departmentId: string | null }> = {}): UsuarioPermisos => ({
  id: extra.id ?? ID,
  role,
  departmentId: extra.departmentId ?? null,
});

interface ScopeAnterior {
  userId: string;
  role: Role;
  departmentId?: string | null;
}

// --- Copia congelada del comportamiento previo (ticket.service.ts) ---------

const ticketAccessWhereAnterior = (
  userId: string,
  role: Role,
  departmentId?: string | null
): Record<string, unknown> => {
  if (role === "ADMIN") return {};
  const scopes: Record<string, unknown>[] = [
    { creadoPorId: userId },
    { asignadoAId: userId },
    { assignments: { some: { userId } } },
  ];
  if (departmentId && (role === "GERENTE" || role === "JEFE_DE_AREA")) scopes.push({ departmentId });
  return { OR: scopes };
};

const assertTicketAccessAnterior = (
  ticket: RecursoAlcanzable,
  scope: ScopeAnterior
): boolean => {
  const { userId, role, departmentId } = scope;
  if (!userId || !role || role === "ADMIN") return true;
  return (
    ticket.creadoPorId === userId ||
    ticket.asignadoAId === userId ||
    !!ticket.assignments?.some((assignment) => assignment.userId === userId) ||
    ((role === "GERENTE" || role === "JEFE_DE_AREA") &&
      !!departmentId &&
      ticket.departmentId === departmentId)
  );
};

const TICKETS: Array<{ nombre: string; ticket: RecursoAlcanzable }> = [
  {
    nombre: "creado por el usuario",
    ticket: { creadoPorId: ID, asignadoAId: null, departmentId: DEPT, assignments: [] },
  },
  {
    nombre: "responsable único",
    ticket: { creadoPorId: OTRO, asignadoAId: ID, departmentId: DEPT, assignments: [] },
  },
  {
    nombre: "con tarea asignada",
    ticket: { creadoPorId: OTRO, asignadoAId: null, departmentId: DEPT, assignments: [{ userId: ID }] },
  },
  {
    nombre: "del área",
    ticket: { creadoPorId: OTRO, asignadoAId: null, departmentId: DEPT, assignments: [] },
  },
  {
    nombre: "de otra área",
    ticket: { creadoPorId: OTRO, asignadoAId: null, departmentId: OTRO_DEPT, assignments: [] },
  },
  {
    nombre: "ajeno",
    ticket: { creadoPorId: OTRO, asignadoAId: OTRO, departmentId: OTRO_DEPT, assignments: [{ userId: OTRO }] },
  },
];

test.describe("equivalencia con ticketAccessWhere (lista de tickets)", () => {
  for (const role of ROLES) {
    test(`${role} filtra igual que antes`, () => {
      const anterior = ticketAccessWhereAnterior(ID, role, DEPT);
      const actual = ticketsVisibles(usuario(role, { id: ID, departmentId: DEPT }));
      expect(actual).toEqual(anterior);
    });

    test(`${role} sin departamento filtra igual que antes`, () => {
      const anterior = ticketAccessWhereAnterior(ID, role, null);
      const actual = ticketsVisibles(usuario(role, { id: ID, departmentId: null }));
      expect(actual).toEqual(anterior);
    });
  }

  test("ADMIN ve todo; EMPLEADO solo lo propio/asignado", () => {
    expect(ticketsVisibles(usuario("ADMIN", { id: ID, departmentId: DEPT }))).toEqual({});
    expect(ticketsVisibles(usuario("EMPLEADO", { id: ID, departmentId: DEPT }))).toEqual({
      OR: [
        { creadoPorId: ID },
        { asignadoAId: ID },
        { assignments: { some: { userId: ID } } },
      ],
    });
  });

  test("AREA sin departamento se comporta como PROPIO", () => {
    const propio = ticketsVisibles(usuario("EMPLEADO", { id: ID, departmentId: null }));
    for (const role of ["GERENTE", "JEFE_DE_AREA"] as const) {
      expect(ticketsVisibles(usuario(role, { id: ID, departmentId: null }))).toEqual(propio);
    }
  });
});

test.describe("equivalencia con assertTicketAccess (acceso por registro)", () => {
  for (const role of ROLES) {
    test(`${role}: puedeVerTicket y dentroDeAlcance reproducen el acceso previo`, () => {
      const scope: ScopeAnterior = { userId: ID, role, departmentId: DEPT };
      const actor = usuario(role, { id: ID, departmentId: DEPT });
      const alcance = alcanceDe(actor, "tickets.ver");
      for (const { nombre, ticket } of TICKETS) {
        const esperado = assertTicketAccessAnterior(ticket, scope);
        expect(puedeVerTicket(actor, ticket), `${role} / ${nombre} (puedeVerTicket)`).toBe(esperado);
        expect(dentroDeAlcance(actor, alcance, ticket), `${role} / ${nombre} (dentroDeAlcance)`).toBe(esperado);
      }
    });

    test(`${role} sin departamento reproduce el acceso previo`, () => {
      const scope: ScopeAnterior = { userId: ID, role, departmentId: null };
      const actor = usuario(role, { id: ID, departmentId: null });
      for (const { nombre, ticket } of TICKETS) {
        const esperado = assertTicketAccessAnterior(ticket, scope);
        expect(puedeVerTicket(actor, ticket), `${role} / ${nombre}`).toBe(esperado);
      }
    });
  }

  test("GERENTE/JEFE alcanzan su departamento; EMPLEADO no", () => {
    const area: RecursoAlcanzable = { creadoPorId: OTRO, departmentId: DEPT };
    expect(puedeVerTicket(usuario("GERENTE", { id: ID, departmentId: DEPT }), area)).toBe(true);
    expect(puedeVerTicket(usuario("JEFE_DE_AREA", { id: ID, departmentId: DEPT }), area)).toBe(true);
    expect(puedeVerTicket(usuario("EMPLEADO", { id: ID, departmentId: DEPT }), area)).toBe(false);
  });
});
