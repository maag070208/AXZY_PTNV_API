import type { Role } from "@prisma/client";
import { PERMISO_KEYS, type Alcance, type Permiso } from "./catalogo";
import { getMatriz } from "./matriz";

/**
 * Excepción de permiso de un usuario (Fase 2). Reemplaza lo que dice su rol.
 * Una excepción vencida se ignora.
 */
export interface ExcepcionPermiso {
  permiso: string;
  alcance: Alcance;
  venceEn?: Date | null;
}

export interface UsuarioPermisos {
  id: string;
  role: Role;
  departmentId?: string | null;
  /** Fase 2: excepciones por empleado. En Fase 1 es opcional/undefined. */
  excepciones?: ReadonlyArray<ExcepcionPermiso>;
}

const vigente = (excepcion: ExcepcionPermiso, ahora: number): boolean =>
  !excepcion.venceEn || excepcion.venceEn.getTime() > ahora;

/**
 * Permiso efectivo = excepción vigente > rol base > NINGUNO (ver
 * ROLES_Y_PERMISOS.md §2).
 */
export const alcanceDe = (usuario: UsuarioPermisos, permiso: Permiso): Alcance => {
  const ahora = Date.now();
  const excepcion = usuario.excepciones?.find(
    (e) => e.permiso === permiso && vigente(e, ahora)
  );
  if (excepcion) return excepcion.alcance;
  return getMatriz()[usuario.role]?.[permiso] ?? "NINGUNO";
};

/** ¿El usuario tiene el permiso con cualquier alcance distinto de NINGUNO? */
export const puedeAlgunAlcance = (usuario: UsuarioPermisos, permiso: Permiso): boolean =>
  alcanceDe(usuario, permiso) !== "NINGUNO";

/** Todos los permisos efectivos del usuario, omitiendo los NINGUNO. */
export const permisosDe = (usuario: UsuarioPermisos): Record<string, Alcance> => {
  const result: Record<string, Alcance> = {};
  for (const permiso of PERMISO_KEYS) {
    const alcance = alcanceDe(usuario, permiso);
    if (alcance !== "NINGUNO") result[permiso] = alcance;
  }
  return result;
};
