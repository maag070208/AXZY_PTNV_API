import type { Prisma } from "@prisma/client";
import type { PermissionScope } from "./catalog";
import { scopeOf, type UserPermissions } from "./resolver";

/**
 * Registro sobre el que se evalúa un alcance. Reutiliza la semántica de
 * `ticketAccessWhere`/`assertTicketAccess` de `tickets/services/ticket.service.ts`
 * (ver ROLES_Y_PERMISOS.md §2).
 */
export interface ResourceReachable {
  createdById?: string | null;
  assignedToId?: string | null;
  departmentId?: string | null;
  assignments?: Array<{ userId: string }>;
}

/** Lo "propio": lo creó, es su responsable o tiene una tarea en él. */
const isOwn = (user: UserPermissions, resource: ResourceReachable): boolean =>
  resource.createdById === user.id ||
  resource.assignedToId === user.id ||
  !!resource.assignments?.some((a) => a.userId === user.id);

/**
 * ¿El registro cae dentro del alcance? `AREA` incluye lo propio y, sin
 * departamento asignado, se comporta como `PROPIO` (§2).
 */
export const withinScope = (
  user: UserPermissions,
  scope: PermissionScope,
  resource: ResourceReachable
): boolean => {
  switch (scope) {
    case "NONE":
      return false;
    case "ALL":
      return true;
    case "OWN":
      return isOwn(user, resource);
    case "AREA":
      return (
        isOwn(user, resource) ||
        (!!user.departmentId && resource.departmentId === user.departmentId)
      );
  }
};

/** Convierte un alcance en filtro Prisma para tickets (o sus tareas). */
const ticketsInScopeWhere = (
  user: UserPermissions,
  scope: PermissionScope
): Prisma.TicketWhereInput => {
  if (scope === "ALL") return {};
  if (scope === "NONE") return { OR: [] };
  const scopes: Prisma.TicketWhereInput[] = [
    { createdById: user.id },
    { assignedToId: user.id },
    { assignments: { some: { userId: user.id } } },
  ];
  if (scope === "AREA" && user.departmentId) scopes.push({ departmentId: user.departmentId });
  return { OR: scopes };
};

/** Filtro Prisma de los tickets visibles según el alcance del permiso. */
export const visibleTickets = (
  user: UserPermissions,
  permission: string = "tickets.view"
): Prisma.TicketWhereInput => ticketsInScopeWhere(user, scopeOf(user, permission));

/** Filtro Prisma de los tickets cuyas tareas son visibles según `tareas.ver`. */
export const visibleTasks = (user: UserPermissions): Prisma.TicketWhereInput =>
  ticketsInScopeWhere(user, scopeOf(user, "tasks.view"));

/** ¿Puede el usuario ver este ticket concreto? */
export const canViewTicket = (user: UserPermissions, ticket: ResourceReachable): boolean =>
  withinScope(user, scopeOf(user, "tickets.view"), ticket);
