import type {
  AccessReportSessionRow,
  AccessReportSummary,
} from "@modules/access/models/entity/access.entity";

/**
 * Fila del reporte de entradas/salidas del reloj: el mismo contrato que el
 * reporte de acceso (la web reutiliza su pantalla) + si la persona ya está
 * vinculada a un usuario. Sin vincular, `employeeId` es `reloj:<número>` y el
 * nombre es el del reloj.
 */
export type ChecadorReportSessionRow = AccessReportSessionRow & { vinculado: boolean };

export interface ChecadorReportResult {
  rows: ChecadorReportSessionRow[];
  summary: AccessReportSummary;
}

/**
 * Evento de control de acceso tal como lo devuelve ISAPI
 * (`POST /ISAPI/AccessControl/AcsEvent?format=json` → `AcsEvent.InfoList[]`).
 * Solo se tipan los campos que usa la sincronización.
 */
export interface AcsEventInfo {
  major: number;
  minor: number;
  /** Hora del reloj con su offset, p. ej. `2026-09-24T09:00:54-07:00`. */
  time: string;
  /** Consecutivo del evento en el reloj (compartido entre todos los tipos). */
  serialNo: number;
  /** Solo viene cuando el reloj identificó a un empleado. */
  employeeNoString?: string;
  name?: string;
}

/** Página de la búsqueda `AcsEvent`. */
export interface AcsEventPage {
  totalMatches: number;
  /** `MORE` mientras quedan páginas; `OK` / `NO MATCH` al terminar. */
  responseStatusStrg: string;
  numOfMatches: number;
  InfoList?: AcsEventInfo[];
}

/** Página ya normalizada: sus eventos + el total de la búsqueda completa. */
export interface AcsEventBatch {
  totalMatches: number;
  eventos: AcsEventInfo[];
}

export interface ChecadorDeviceInfo {
  serialNumber: string;
  model: string | null;
}

export interface ChecadorProgreso {
  startedAt: Date;
  leidos: number;
  nuevas: number;
  /**
   * Eventos que reportó la última búsqueda. Baja a medida que se avanza (el
   * reloj recalcula lo que falta), así que no promete cuánto queda.
   */
  restantes: number | null;
  /** Eventos totales de la corrida; se fija con el primero que reporta el reloj. */
  total: number | null;
}

/** Una corrida de sincronización (la última queda en memoria del proceso). */
export interface ChecadorCorrida {
  ok: boolean;
  dispositivoSerie: string | null;
  startedAt: Date;
  finishedAt: Date;
  /** Eventos leídos del reloj (de cualquier tipo, no solo checadas). */
  leidos: number;
  /** Checadas nuevas guardadas; los duplicados no cuentan. */
  nuevas: number;
  /** Cursor al terminar: todo consecutivo `<=` ya está procesado. */
  ultimoSerialNo: number | null;
  error: string | null;
}

/**
 * Importación manual por rango de fechas: la que está en curso o la última.
 * Sigue en curso mientras `finishedAt` es null; terminó bien si `error` es null.
 */
export interface ChecadorImportacion {
  /** Días locales `YYYY-MM-DD` del rango, inclusive. */
  desde: string;
  hasta: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** Eventos del rango en el reloj (se conoce con la primera página). */
  total: number | null;
  leidos: number;
  nuevas: number;
  error: string | null;
}

/** Usuario del sistema al que apunta (o podría apuntar) un número del reloj. */
export interface ChecadorUsuarioRef {
  userId: string;
  name: string;
  numeroEmpleado: string | null;
  active: boolean;
}

/**
 * Qué tan confiable es una sugerencia de vínculo: `ALTA` = el nombre coincide
 * y también el número de nómina (sin el prefijo de área del reloj); `MEDIA` =
 * solo el nombre coincide y no hay otro usuario igual de parecido.
 */
export type ChecadorConfianza = "ALTA" | "MEDIA";

/** Un empleado dado de alta en el reloj (visto en sus checadas) y su vínculo. */
export interface ChecadorEmpleadoRow {
  /** Número del empleado en el reloj (llave del vínculo). */
  numeroEmpleado: string;
  /** Nombre como está en el reloj (el de su checada más reciente). */
  nombre: string;
  checadas: number;
  ultimaChecada: Date;
  vinculo: ChecadorUsuarioRef | null;
  sugerencia: (ChecadorUsuarioRef & { confianza: ChecadorConfianza }) | null;
}

export interface ChecadorEmpleadosSummary {
  total: number;
  vinculados: number;
  sinVincular: number;
  /** Sin vincular con sugerencia `ALTA` (las que vincula el botón masivo). */
  sugeridosAlta: number;
}

export interface ChecadorDispositivoStatus {
  dispositivoSerie: string;
  modelo: string | null;
  ultimoSerialNo: number;
  sincronizadoEn: Date | null;
  checadas: number;
  ultimaChecada: Date | null;
}

export interface ChecadorStatus {
  /** `false` sin `CHECADOR_URL`: no se sincroniza. */
  configurado: boolean;
  /** Corrida en curso (p. ej. la carga inicial del historial). */
  enCurso: ChecadorProgreso | null;
  /** El reloj rechazó las credenciales: la sincronización automática se detuvo. */
  pausadoPorCredenciales: boolean;
  ultimaCorrida: ChecadorCorrida | null;
  /** Importación manual en curso o la última. */
  importacion: ChecadorImportacion | null;
  dispositivos: ChecadorDispositivoStatus[];
}
