import type { Prisma } from "@prisma/client";
import type { Alcance, Permiso } from "./catalogo";
import { alcanceDe, type UsuarioPermisos } from "./resolver";

/**
 * Registro sobre el que se evalúa un alcance. Reutiliza la semántica de
 * `ticketAccessWhere`/`assertTicketAccess` de `tickets/services/ticket.service.ts`
 * (ver ROLES_Y_PERMISOS.md §2).
 */
export interface RecursoAlcanzable {
  creadoPorId?: string | null;
  asignadoAId?: string | null;
  departmentId?: string | null;
  assignments?: Array<{ userId: string }>;
}

/** Lo "propio": lo creó, es su responsable o tiene una tarea en él. */
const esPropio = (usuario: UsuarioPermisos, recurso: RecursoAlcanzable): boolean =>
  recurso.creadoPorId === usuario.id ||
  recurso.asignadoAId === usuario.id ||
  !!recurso.assignments?.some((a) => a.userId === usuario.id);

/**
 * ¿El registro cae dentro del alcance? `AREA` incluye lo propio y, sin
 * departamento asignado, se comporta como `PROPIO` (§2).
 */
export const dentroDeAlcance = (
  usuario: UsuarioPermisos,
  alcance: Alcance,
  recurso: RecursoAlcanzable
): boolean => {
  switch (alcance) {
    case "NINGUNO":
      return false;
    case "TODO":
      return true;
    case "PROPIO":
      return esPropio(usuario, recurso);
    case "AREA":
      return (
        esPropio(usuario, recurso) ||
        (!!usuario.departmentId && recurso.departmentId === usuario.departmentId)
      );
  }
};

/** Convierte un alcance en filtro Prisma para tickets (o sus tareas). */
const ticketsWhereDeAlcance = (
  usuario: UsuarioPermisos,
  alcance: Alcance
): Prisma.TicketWhereInput => {
  if (alcance === "TODO") return {};
  if (alcance === "NINGUNO") return { OR: [] };
  const scopes: Prisma.TicketWhereInput[] = [
    { creadoPorId: usuario.id },
    { asignadoAId: usuario.id },
    { assignments: { some: { userId: usuario.id } } },
  ];
  if (alcance === "AREA" && usuario.departmentId) scopes.push({ departmentId: usuario.departmentId });
  return { OR: scopes };
};

/** Filtro Prisma de los tickets visibles según el alcance del permiso. */
export const ticketsVisibles = (
  usuario: UsuarioPermisos,
  permiso: Permiso = "tickets.ver"
): Prisma.TicketWhereInput => ticketsWhereDeAlcance(usuario, alcanceDe(usuario, permiso));

/** Filtro Prisma de los tickets cuyas tareas son visibles según `tareas.ver`. */
export const tareasVisibles = (usuario: UsuarioPermisos): Prisma.TicketWhereInput =>
  ticketsWhereDeAlcance(usuario, alcanceDe(usuario, "tareas.ver"));

/** ¿Puede el usuario ver este ticket concreto? */
export const puedeVerTicket = (usuario: UsuarioPermisos, ticket: RecursoAlcanzable): boolean =>
  dentroDeAlcance(usuario, alcanceDe(usuario, "tickets.ver"), ticket);
