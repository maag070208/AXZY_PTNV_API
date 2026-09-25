export {
  ALCANCES,
  getCatalogo,
  setCatalogo,
  resetCatalogo,
  catalogoFromRows,
  cargarCatalogoDesdeDb,
  sembrarCatalogo,
  esPermiso,
  clavesDeCatalogo,
  definicionDe,
  type Alcance,
  type DefinicionPermiso,
  type CatalogoFila,
} from "./catalogo";
export {
  loadPermisosFixture,
  loadRolPermisosFixture,
  sembrarPermisosDesdeFixtures,
  type RolPermisoFixtureFila,
} from "./fixtures";
export {
  getMatriz,
  setMatriz,
  resetMatriz,
  invalidarMatriz,
  matrizFromRows,
  cargarMatrizDesdeDb,
  cargarPermisosDesdeDb,
  type MatrizRoles,
  type MatrizFila,
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
