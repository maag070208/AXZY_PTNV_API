/**
 * Catálogo de permisos del sistema. Es la fuente única de verdad de las claves
 * que existen: un permiso solo significa algo si el código lo revisa, por eso
 * vive en código y no en la base (ver ROLES_Y_PERMISOS.md §5).
 *
 * El catálogo reproduce la matriz §3 del documento. Los permisos "sí/no" solo
 * admiten NINGUNO/TODO; los que dependen del registro admiten PROPIO/AREA/TODO;
 * los que aplican por área (bitácora, checadas, horas extra y permisos) solo
 * admiten AREA/TODO. Quitar un permiso siempre es una excepción con NINGUNO.
 */
export type Alcance = "NINGUNO" | "PROPIO" | "AREA" | "TODO";

export interface DefinicionPermiso {
  modulo: string;
  nombre: string;
  descripcion?: string;
  alcances: readonly Alcance[];
  sensible?: boolean;
}

export const PERMISOS = {
  // Tickets y tareas
  "tickets.ver": {
    modulo: "Tickets",
    nombre: "Ver tickets",
    descripcion: "Ver tickets, comentar y adjuntar archivos",
    alcances: ["PROPIO", "AREA", "TODO"],
  },
  "tickets.crear": {
    modulo: "Tickets",
    nombre: "Crear tickets",
    descripcion: "Levantar tickets",
    alcances: ["NINGUNO", "TODO"],
  },
  "tickets.editar": {
    modulo: "Tickets",
    nombre: "Editar tickets",
    descripcion:
      "Título, descripción, prioridad, categoría, responsable y estado (menos cerrar). Con TODO también cambia el departamento",
    alcances: ["PROPIO", "AREA", "TODO"],
  },
  "tickets.cerrar": {
    modulo: "Tickets",
    nombre: "Cerrar tickets",
    descripcion: "Cerrar tickets",
    alcances: ["PROPIO", "AREA", "TODO"],
  },
  "tickets.eliminar": {
    modulo: "Tickets",
    nombre: "Eliminar tickets",
    descripcion: "Borrar tickets",
    alcances: ["NINGUNO", "TODO"],
  },
  "tareas.ver": {
    modulo: "Tareas",
    nombre: "Ver tareas",
    descripcion:
      'Ver tareas en el tablero y en "Administrar tareas" (esta última con AREA o TODO)',
    alcances: ["PROPIO", "AREA", "TODO"],
  },
  "tareas.asignar": {
    modulo: "Tareas",
    nombre: "Asignar tareas",
    descripcion: "Crear, editar y retirar tareas; moverlas entre estados sin completarlas",
    alcances: ["PROPIO", "AREA", "TODO"],
  },
  "tareas.completar": {
    modulo: "Tareas",
    nombre: "Completar tareas",
    descripcion: "Completar tareas o moverlas a cualquier estado",
    alcances: ["PROPIO", "AREA", "TODO"],
  },

  // Inventario
  "dispositivos.ver": {
    modulo: "Inventario",
    nombre: "Ver dispositivos",
    descripcion:
      "Ver dispositivos, tipos, unidades, existencias, kardex, movimientos y panel de inventario",
    alcances: ["NINGUNO", "TODO"],
  },
  "dispositivos.crear": {
    modulo: "Inventario",
    nombre: "Crear dispositivos",
    descripcion: "Alta de dispositivos (lotes) y unidades físicas",
    alcances: ["NINGUNO", "TODO"],
  },
  "dispositivos.editar": {
    modulo: "Inventario",
    nombre: "Editar dispositivos",
    descripcion:
      "Editar dispositivos/unidades y registrar movimientos (mantenimiento, baja, reversión)",
    alcances: ["NINGUNO", "TODO"],
  },
  "dispositivos.eliminar": {
    modulo: "Inventario",
    nombre: "Eliminar dispositivos",
    descripcion: "Eliminar dispositivos",
    alcances: ["NINGUNO", "TODO"],
  },
  "prestamos.ver": {
    modulo: "Préstamos",
    nombre: "Ver préstamos",
    descripcion: "Ver préstamos (cartas responsivas) y devoluciones",
    alcances: ["NINGUNO", "TODO"],
  },
  "prestamos.crear": {
    modulo: "Préstamos",
    nombre: "Crear préstamos",
    descripcion: "Crear préstamos (cartas responsivas)",
    alcances: ["NINGUNO", "TODO"],
  },
  "prestamos.editar": {
    modulo: "Préstamos",
    nombre: "Editar préstamos",
    descripcion: "Editar préstamos y registrar devoluciones",
    alcances: ["NINGUNO", "TODO"],
  },
  "prestamos.eliminar": {
    modulo: "Préstamos",
    nombre: "Eliminar préstamos",
    descripcion: "Cancelar/eliminar préstamos",
    alcances: ["NINGUNO", "TODO"],
  },
  "salidas.registrar": {
    modulo: "Salidas",
    nombre: "Registrar salidas",
    descripcion: "Registrar, editar y borrar salidas de material",
    alcances: ["NINGUNO", "TODO"],
  },

  // Reportes
  "reportes.ver": {
    modulo: "Reportes",
    nombre: "Ver reportes",
    descripcion:
      "Ver reportes: entregas (cartas/items), dispositivos asignados, inventario completo y bitácora de salidas",
    alcances: ["NINGUNO", "TODO"],
  },
  "reportes.exportar": {
    modulo: "Reportes",
    nombre: "Exportar reportes",
    descripcion: "Exportar reportes: CSV server-side y PDF client-side de la página de reportes",
    alcances: ["NINGUNO", "TODO"],
  },

  // Personal, usuarios y catálogos
  "personal.expediente": {
    modulo: "Personal",
    nombre: "Ver expediente del personal",
    descripcion: "Ver y editar el expediente completo: datos, documentos, foto, descuentos",
    alcances: ["NINGUNO", "TODO"],
  },
  "personal.actas": {
    modulo: "Personal",
    nombre: "Actas administrativas",
    descripcion: "Levantar y consultar actas administrativas",
    alcances: ["NINGUNO", "TODO"],
  },
  "usuarios.ver": {
    modulo: "Usuarios",
    nombre: "Ver usuarios",
    descripcion: "Ver cuentas de usuario",
    alcances: ["NINGUNO", "TODO"],
  },
  "usuarios.crear": {
    modulo: "Usuarios",
    nombre: "Crear usuarios",
    descripcion: "Alta de cuentas e importación desde Excel",
    alcances: ["NINGUNO", "TODO"],
  },
  "usuarios.editar": {
    modulo: "Usuarios",
    nombre: "Editar usuarios",
    descripcion: "Editar cuentas, cambiar contraseñas, dar de baja y reactivar",
    alcances: ["NINGUNO", "TODO"],
  },
  "usuarios.eliminar": {
    modulo: "Usuarios",
    nombre: "Eliminar usuarios",
    descripcion: "Eliminar cuentas",
    alcances: ["NINGUNO", "TODO"],
  },
  "usuarios.permisos": {
    modulo: "Usuarios",
    nombre: "Cambiar permisos",
    descripcion:
      "Otorgar y quitar excepciones de permisos; cambiar el rol (solo con alcance TODO)",
    alcances: ["AREA", "TODO"],
    sensible: true,
  },
  "departamentos.administrar": {
    modulo: "Catálogos",
    nombre: "Administrar departamentos",
    descripcion: "Crear y editar departamentos y subáreas",
    alcances: ["NINGUNO", "TODO"],
  },
  "catalogos.administrar": {
    modulo: "Catálogos",
    nombre: "Administrar catálogos",
    descripcion:
      "Categorías de ticket, tipos de dispositivo, géneros, tipos de sangre y de documento",
    alcances: ["NINGUNO", "TODO"],
  },

  // Control de acceso (portería)
  "acceso.escanear": {
    modulo: "Control de acceso",
    nombre: "Escanear credenciales",
    descripcion:
      "Escanear credenciales, registrar entradas/salidas y ver sus registros del día",
    alcances: ["NINGUNO", "TODO"],
  },
  "acceso.bitacora": {
    modulo: "Control de acceso",
    nombre: "Ver bitácora de acceso",
    descripcion: "Bitácora, reporte de entradas/salidas y estadísticas",
    alcances: ["AREA", "TODO"],
  },
  "acceso.anular": {
    modulo: "Control de acceso",
    nombre: "Anular registros de acceso",
    descripcion: "Anular registros de la bitácora",
    alcances: ["NINGUNO", "TODO"],
  },
  "acceso.sitios": {
    modulo: "Control de acceso",
    nombre: "Administrar sitios",
    descripcion: "Administrar sitios (porterías)",
    alcances: ["NINGUNO", "TODO"],
  },

  // Checador (relojes)
  "checador.ver": {
    modulo: "Checador",
    nombre: "Ver checadas",
    descripcion: "Checadas y reporte de entradas/salidas del reloj",
    alcances: ["AREA", "TODO"],
  },
  "checador.sincronizar": {
    modulo: "Checador",
    nombre: "Sincronizar checador",
    descripcion: "Importar por fechas y forzar la sincronización",
    alcances: ["NINGUNO", "TODO"],
  },
  "checador.vincular": {
    modulo: "Checador",
    nombre: "Vincular números del reloj",
    descripcion: "Vincular números del reloj con empleados",
    alcances: ["NINGUNO", "TODO"],
  },
  "relojes.administrar": {
    modulo: "Checador",
    nombre: "Administrar relojes",
    descripcion: "Alta, baja y configuración de relojes (con los relojes solo se lee)",
    alcances: ["NINGUNO", "TODO"],
    sensible: true,
  },

  // Horarios y horas extra
  "horarios.ver": {
    modulo: "Horarios",
    nombre: "Ver horarios",
    descripcion: "Consultar horarios y a quién están asignados",
    alcances: ["NINGUNO", "TODO"],
  },
  "horarios.administrar": {
    modulo: "Horarios",
    nombre: "Administrar horarios",
    descripcion: "Crear horarios y asignarlos en bloque",
    alcances: ["NINGUNO", "TODO"],
  },
  "horas_extra.ver": {
    modulo: "Horas extra",
    nombre: "Ver horas extra",
    descripcion: "Consultar y exportar horas extra",
    alcances: ["AREA", "TODO"],
  },
  "horas_extra.aprobar": {
    modulo: "Horas extra",
    nombre: "Aprobar horas extra",
    descripcion: "Aprobar horas extra",
    alcances: ["AREA", "TODO"],
  },

  // Sistema
  "panel.ver": {
    modulo: "Sistema",
    nombre: "Ver panel",
    descripcion: "Panel de indicadores en el inicio",
    alcances: ["NINGUNO", "TODO"],
  },
  "auditoria.ver": {
    modulo: "Sistema",
    nombre: "Ver auditoría",
    descripcion: "Auditoría del sistema",
    alcances: ["NINGUNO", "TODO"],
    sensible: true,
  },
  "sistema.configurar": {
    modulo: "Sistema",
    nombre: "Configurar el sistema",
    descripcion: "Configuración general y correos",
    alcances: ["NINGUNO", "TODO"],
    sensible: true,
  },
} as const satisfies Record<string, DefinicionPermiso>;

export type Permiso = keyof typeof PERMISOS;

export const PERMISO_KEYS = Object.keys(PERMISOS) as readonly Permiso[];

export const esPermiso = (v: string): v is Permiso =>
  Object.prototype.hasOwnProperty.call(PERMISOS, v);
