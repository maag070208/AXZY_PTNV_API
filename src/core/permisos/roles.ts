import type { Role } from "@prisma/client";
import { PERMISO_KEYS, type Alcance, type Permiso } from "./catalogo";

/**
 * Matriz de roles base — **Fase 1** (ver ROLES_Y_PERMISOS.md §3).
 *
 * Solo se listan las claves con alcance distinto de NINGUNO: la ausencia de una
 * clave significa NINGUNO. Las diferencias entre la matriz de diseño §3 y esta
 * matriz de Fase 1 están documentadas en `DESVIACIONES_MATRIZ`.
 */
const todo = (): Record<Permiso, Alcance> =>
  Object.fromEntries(PERMISO_KEYS.map((k) => [k, "TODO"])) as Record<Permiso, Alcance>;

export const ROLES_BASE: Record<Role, Partial<Record<Permiso, Alcance>>> = {
  ADMIN: todo(),

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

export interface DesviacionMatriz {
  /** Clave concreta del catálogo. */
  permiso: Permiso;
  rol: Role;
  /** Alcance que dicta la matriz de diseño §3. */
  diseno: Alcance;
  /** Alcance que aplica la matriz de Fase 1. */
  fase1: Alcance;
  /** Referencia a la sección/nota que respalda la decisión. */
  ref: string;
}

/**
 * Decisiones tomadas para Fase 1 sobre la matriz de diseño §3. Incluye tanto
 * los cambios reales (p. ej. `usuarios.*` de GERENTE/JEFE) como las decisiones
 * que solo confirman lo que §3 ya decía (p. ej. el JEFE sin inventario).
 */
export const DESVIACIONES_MATRIZ: readonly DesviacionMatriz[] = [
  // Usuarios: solo ADMIN (§9 #10, abierto) — cierra GERENTE y JEFE.
  { permiso: "usuarios.ver", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.crear", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.editar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.eliminar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.ver", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.crear", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.editar", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },
  { permiso: "usuarios.eliminar", rol: "JEFE_DE_AREA", diseno: "TODO", fase1: "NINGUNO", ref: "§9 #10" },

  // Administración: solo ADMIN.
  { permiso: "departamentos.administrar", rol: "GERENTE", diseno: "TODO", fase1: "NINGUNO", ref: "§7.3" },
  { permiso: "auditoria.ver", rol: "GERENTE", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§7.3 / §3" },
  { permiso: "sistema.configurar", rol: "GERENTE", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§7.3 / §3" },

  // El GERENTE conserva `usuarios.permisos` con alcance AREA (§11.2); en Fase 1
  // no se enforcea todavía.
  { permiso: "usuarios.permisos", rol: "GERENTE", diseno: "AREA", fase1: "AREA", ref: "§11.2 (se conserva; no se enforcea en Fase 1)" },

  // Panel y reportes: ADMIN + GERENTE; el JEFE no (§3, confirmado).
  { permiso: "panel.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },
  { permiso: "reportes.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },
  { permiso: "reportes.exportar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§3" },

  // El JEFE no gestiona inventario (§9 #3).
  { permiso: "dispositivos.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "dispositivos.crear", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "dispositivos.editar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "dispositivos.eliminar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "prestamos.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "prestamos.crear", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "prestamos.editar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },
  { permiso: "prestamos.eliminar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #3" },

  // El JEFE no consulta ni sincroniza el checador, ni ve horarios (§9 #4).
  { permiso: "checador.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
  { permiso: "checador.sincronizar", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
  { permiso: "horarios.ver", rol: "JEFE_DE_AREA", diseno: "NINGUNO", fase1: "NINGUNO", ref: "§9 #4" },
];

/**
 * Permisos que la matriz §3 ya define, pero que el API todavía deja abiertos en
 * Fase 1 (aún no se reemplazan los `authorize([...])` del inventario). Se
 * cerrarán en el Incremento 2+.
 */
export const ENFORCEMENT_PENDIENTE: readonly Permiso[] = ["dispositivos.ver", "prestamos.ver"];
