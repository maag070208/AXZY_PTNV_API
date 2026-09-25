export {
  PERMISOS,
  PERMISO_KEYS,
  esPermiso,
  type Alcance,
  type DefinicionPermiso,
  type Permiso,
} from "./catalogo";
export {
  ROLES_BASE,
  DESVIACIONES_MATRIZ,
  ENFORCEMENT_PENDIENTE,
  type DesviacionMatriz,
} from "./roles";
export {
  getMatriz,
  setMatriz,
  resetMatriz,
  invalidarMatriz,
  matrizFromRows,
  cargarMatrizDesdeDb,
  filasMatrizPorDefecto,
  sembrarMatrizPorDefecto,
  type MatrizRoles,
  type MatrizFila,
  type MatrizFilaDefecto,
} from "./matriz";
export {
  alcanceDe,
  puedeAlgunAlcance,
  permisosDe,
  type ExcepcionPermiso,
  type UsuarioPermisos,
} from "./resolver";
export {
  dentroDeAlcance,
  ticketsVisibles,
  tareasVisibles,
  puedeVerTicket,
  type RecursoAlcanzable,
} from "./alcance";
