import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import {
  scopeOf,
  withinScope,
  canViewTicket,
  visibleTickets,
  catalogFromRows,
  setCatalog,
  matrixFromRows,
  setMatrix,
  loadPermissionsFixture,
  loadRolePermissionsFixture,
  type ResourceReachable,
  type UserPermissions,
} from "../../src/core/permissions";

/**
 * Fija la equivalencia entre las funciones de alcance de `@core/permisos` y la
 * autorización que el dominio de tickets tenía embebida antes del refactor
 * (`ticketAccessWhere` / `assertTicketAccess`). Las implementaciones de abajo
 * son una copia congelada del código anterior: si el refactor cambia el
 * resultado por rol, esta prueba falla. Sin BD: el catálogo y la matriz se
 * inyectan desde los fixtures.
 */

test.beforeAll(() => {
  setCatalog(catalogFromRows(loadPermissionsFixture()));
  setMatrix(matrixFromRows(loadRolePermissionsFixture()));
});

const ROLES: readonly Role[] = [
  "ADMIN",
  "MANAGER",
  "AREA_HEAD",
  "EMPLOYEE",
  "HUMAN_RESOURCES",
  "GUARD",
];

const ID = "user-1";
const DEPT = "dept-1";
const OTHER = "user-2";
const OTHER_DEPT = "dept-2";

const user = (role: Role, extra: Partial<{ id: string; departmentId: string | null }> = {}): UserPermissions => ({
  id: extra.id ?? ID,
  role,
  departmentId: extra.departmentId ?? null,
});

interface PreviousScope {
  userId: string;
  role: Role;
  departmentId?: string | null;
}

// --- Copia congelada del comportamiento previo (ticket.service.ts) ---------

const ticketAccessPreviousWhere = (
  userId: string,
  role: Role,
  departmentId?: string | null
): Record<string, unknown> => {
  if (role === "ADMIN") return {};
  const scopes: Record<string, unknown>[] = [
    { createdById: userId },
    { assignedToId: userId },
    { assignments: { some: { userId } } },
  ];
  if (departmentId && (role === "MANAGER" || role === "AREA_HEAD")) scopes.push({ departmentId });
  return { OR: scopes };
};

const assertTicketPreviousAccess = (
  ticket: ResourceReachable,
  scope: PreviousScope
): boolean => {
  const { userId, role, departmentId } = scope;
  if (!userId || !role || role === "ADMIN") return true;
  return (
    ticket.createdById === userId ||
    ticket.assignedToId === userId ||
    !!ticket.assignments?.some((assignment) => assignment.userId === userId) ||
    ((role === "MANAGER" || role === "AREA_HEAD") &&
      !!departmentId &&
      ticket.departmentId === departmentId)
  );
};

const TICKETS: Array<{ name: string; ticket: ResourceReachable }> = [
  {
    name: "creado por el usuario",
    ticket: { createdById: ID, assignedToId: null, departmentId: DEPT, assignments: [] },
  },
  {
    name: "responsable único",
    ticket: { createdById: OTHER, assignedToId: ID, departmentId: DEPT, assignments: [] },
  },
  {
    name: "con tarea asignada",
    ticket: { createdById: OTHER, assignedToId: null, departmentId: DEPT, assignments: [{ userId: ID }] },
  },
  {
    name: "del área",
    ticket: { createdById: OTHER, assignedToId: null, departmentId: DEPT, assignments: [] },
  },
  {
    name: "de otra área",
    ticket: { createdById: OTHER, assignedToId: null, departmentId: OTHER_DEPT, assignments: [] },
  },
  {
    name: "others",
    ticket: { createdById: OTHER, assignedToId: OTHER, departmentId: OTHER_DEPT, assignments: [{ userId: OTHER }] },
  },
];

test.describe("equivalencia con ticketAccessWhere (lista de tickets)", () => {
  for (const role of ROLES) {
    test(`${role} filtra igual que antes`, () => {
      const previous = ticketAccessPreviousWhere(ID, role, DEPT);
      const actual = visibleTickets(user(role, { id: ID, departmentId: DEPT }));
      expect(actual).toEqual(previous);
    });

    test(`${role} sin departamento filtra igual que antes`, () => {
      const previous = ticketAccessPreviousWhere(ID, role, null);
      const actual = visibleTickets(user(role, { id: ID, departmentId: null }));
      expect(actual).toEqual(previous);
    });
  }

  test("ADMIN ve todo; EMPLEADO solo lo propio/asignado", () => {
    expect(visibleTickets(user("ADMIN", { id: ID, departmentId: DEPT }))).toEqual({});
    expect(visibleTickets(user("EMPLOYEE", { id: ID, departmentId: DEPT }))).toEqual({
      OR: [
        { createdById: ID },
        { assignedToId: ID },
        { assignments: { some: { userId: ID } } },
      ],
    });
  });

  test("AREA sin departamento se comporta como PROPIO", () => {
    const own = visibleTickets(user("EMPLOYEE", { id: ID, departmentId: null }));
    for (const role of ["MANAGER", "AREA_HEAD"] as const) {
      expect(visibleTickets(user(role, { id: ID, departmentId: null }))).toEqual(own);
    }
  });
});

test.describe("equivalencia con assertTicketAccess (acceso por registro)", () => {
  for (const role of ROLES) {
    test(`${role}: puedeVerTicket y dentroDeAlcance reproducen el acceso previo`, () => {
      const scope: PreviousScope = { userId: ID, role, departmentId: DEPT };
      const actor = user(role, { id: ID, departmentId: DEPT });
      const ticketScope = scopeOf(actor, "tickets.view");
      for (const { name, ticket } of TICKETS) {
        const expected = assertTicketPreviousAccess(ticket, scope);
        expect(canViewTicket(actor, ticket), `${role} / ${name} (puedeVerTicket)`).toBe(expected);
        expect(withinScope(actor, ticketScope, ticket), `${role} / ${name} (dentroDeAlcance)`).toBe(expected);
      }
    });

    test(`${role} sin departamento reproduce el acceso previo`, () => {
      const scope: PreviousScope = { userId: ID, role, departmentId: null };
      const actor = user(role, { id: ID, departmentId: null });
      for (const { name, ticket } of TICKETS) {
        const expected = assertTicketPreviousAccess(ticket, scope);
        expect(canViewTicket(actor, ticket), `${role} / ${name}`).toBe(expected);
      }
    });
  }

  test("GERENTE/JEFE alcanzan su departamento; EMPLEADO no", () => {
    const area: ResourceReachable = { createdById: OTHER, departmentId: DEPT };
    expect(canViewTicket(user("MANAGER", { id: ID, departmentId: DEPT }), area)).toBe(true);
    expect(canViewTicket(user("AREA_HEAD", { id: ID, departmentId: DEPT }), area)).toBe(true);
    expect(canViewTicket(user("EMPLOYEE", { id: ID, departmentId: DEPT }), area)).toBe(false);
  });
});
