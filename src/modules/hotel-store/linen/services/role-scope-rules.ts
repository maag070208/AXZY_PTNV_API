import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Alcance por puesto de Blancos (Blancos v3 F5). Reglas puras, sin base de datos: el permiso
 * solo no alcanza para recortar por ubicación, así que los servicios las aplican además del seed.
 * - Auxiliar de piso: solo traslada sucio de roperías (ZONE/DIRTY) a Lavandería y recibe limpio.
 * - Lavandería: existencias de LAUNDRY (incluye Cuarentena), sin conteo, no saca de Cuarentena
 *   y solo envía limpio (LAUNDRY/CLEAN) a las áreas (ZONE/POINT/SPA).
 */

export type LinenScopeProfile = "FLOOR_ASSISTANT" | "LAUNDRY";

export const FLOOR_ASSISTANT_ROLE = "FLOOR_ASSISTANT";
export const LAUNDRY_ROLE = "HOTEL_LAUNDRY";
/** Gerencia / supervisión general: pueden sacar piezas de Cuarentena. */
export const QUARANTINE_ROLES = ["ADMIN", "HOTEL_OPS_MANAGER", "GERENCIA", "HOTEL_GENERAL_SUPERVISOR"];
/** Áreas que reciben limpio desde Lavandería. */
export const LAUNDRY_DESTINATION_KINDS = ["ZONE", "POINT", "SPA"];

/**
 * Perfil restringido del usuario: solo si TODOS sus roles son el mismo puesto restringido.
 * Quien además tiene otro rol (supervisión, gerencia...) no se recorta.
 */
export const linenScopeProfile = (roles: string[] | undefined): LinenScopeProfile | null => {
  const list = roles ?? [];
  if (list.length === 0) return null;
  if (list.every((r) => r === FLOOR_ASSISTANT_ROLE)) return "FLOOR_ASSISTANT";
  if (list.every((r) => r === LAUNDRY_ROLE)) return "LAUNDRY";
  return null;
};

export const canMoveFromQuarantine = (roles: string[] | undefined): boolean =>
  (roles ?? []).some((r) => QUARANTINE_ROLES.includes(r));

const forbid = (profile: LinenScopeProfile): never => {
  throw new HttpError(403, profile === "FLOOR_ASSISTANT" ? "HOTEL_SCOPE_FLOOR_ASSISTANT" : "HOTEL_SCOPE_LAUNDRY");
};

/** El perfil no puede consultar existencias, conteos, bajas, reportes ni flujo. */
export const assertNotFloorAssistant = (roles: string[] | undefined): void => {
  if (linenScopeProfile(roles) === "FLOOR_ASSISTANT") forbid("FLOOR_ASSISTANT");
};

/** Conteo físico: ni la Auxiliar de piso ni Lavandería cuentan (lo cuenta la supervisión). */
export const assertCanCount = (roles: string[] | undefined): void => {
  const profile = linenScopeProfile(roles);
  if (profile) forbid(profile);
};

export interface TransferScopeInput {
  fromKind: string | null | undefined;
  toKind: string | null | undefined;
  /** Código de la ubicación de origen de cada línea (null si no se indicó). */
  fromLocationCodes: Array<string | null | undefined>;
  toLocationCodes?: Array<string | null | undefined>;
}

/**
 * Envío de traspaso: Auxiliar solo ZONE/DIRTY -> LAUNDRY; Lavandería solo LAUNDRY/CLEAN -> ZONE/POINT/SPA.
 */
export const assertTransferSendScope = (roles: string[] | undefined, t: TransferScopeInput): void => {
  const profile = linenScopeProfile(roles);
  if (!profile) return;
  if (profile === "FLOOR_ASSISTANT") {
    const ok =
      t.fromKind === "ZONE" &&
      t.toKind === "LAUNDRY" &&
      t.fromLocationCodes.every((c) => c === "DIRTY") &&
      (t.toLocationCodes ?? []).every((c) => !c || c === "DIRTY");
    if (!ok) forbid(profile);
    return;
  }
  const ok =
    t.fromKind === "LAUNDRY" &&
    LAUNDRY_DESTINATION_KINDS.includes(t.toKind ?? "") &&
    t.fromLocationCodes.every((c) => c === "CLEAN");
  if (!ok) forbid(profile);
};

/** Proceso de lavandería: sacar de Cuarentena solo con rol de gerencia / supervisión general. */
export const assertProcessScope = (roles: string[] | undefined, moves: Array<{ from: string }>): void => {
  if (moves.some((m) => m.from === "QUARANTINE") && !canMoveFromQuarantine(roles)) throw new HttpError(403, "HOTEL_SCOPE_LAUNDRY_QUARANTINE");
};

/** Devolución a proveedor: desde Cuarentena igual que el proceso; la Auxiliar no la hace. */
export const assertSupplierReturnScope = (roles: string[] | undefined, stages: string[]): void => {
  assertNotFloorAssistant(roles);
  if (stages.includes("QUARANTINE") && !canMoveFromQuarantine(roles)) throw new HttpError(403, "HOTEL_SCOPE_LAUNDRY_QUARANTINE");
};

/** Primera lavada (bodega de nuevos -> lavandería): ninguno de los dos puestos restringidos. */
export const assertCanFirstWash = (roles: string[] | undefined): void => {
  const profile = linenScopeProfile(roles);
  if (profile) forbid(profile);
};
