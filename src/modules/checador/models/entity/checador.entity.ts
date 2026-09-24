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

/** Identidad del equipo (`GET /ISAPI/System/deviceInfo`). */
export interface ChecadorDeviceInfo {
  serialNumber: string;
  model: string | null;
  /** Nombre configurado en el propio reloj (p. ej. "RH"). */
  deviceName: string | null;
  firmwareVersion: string | null;
  macAddress: string | null;
}

/** Hora del equipo (`GET /ISAPI/System/time`). */
export interface ChecadorDeviceTime {
  /** Tal como la reporta el reloj, con su offset (`2026-09-24T13:39:19-07:00`). */
  localTime: string;
  instante: Date;
  /** `manual` o `NTP`. */
  timeMode: string | null;
  /** Zona POSIX del reloj (`CST+7:00:00` = UTC−7). */
  timeZone: string | null;
}

/** Personas dadas de alta en el equipo (`GET /ISAPI/AccessControl/UserInfo/Count`). */
export interface ChecadorUserCount {
  userNumber: number;
  bindFaceUserNumber: number;
  bindFingerprintUserNumber: number;
  bindCardUserNumber: number;
}

/**
 * Configuración de un reloj leída en vivo del equipo (solo lectura). `hora` y
 * `personas` quedan en `null` si el reloj no las pudo dar.
 */
export interface ChecadorRelojConfig {
  dispositivoSerie: string;
  leidoEn: Date;
  dispositivo: {
    nombre: string | null;
    modelo: string | null;
    firmware: string | null;
    mac: string | null;
  };
  hora: {
    /** Hora del reloj con su offset, como la reporta. */
    horaLocal: string;
    modo: string | null;
    zona: string | null;
    /** Reloj − servidor, en segundos (positivo = el reloj va adelantado). */
    desfaseSegundos: number;
  } | null;
  personas: {
    total: number;
    conRostro: number;
    conHuella: number;
    conTarjeta: number;
  } | null;
}

export interface ChecadorProgreso {
  startedAt: Date;
  /** Eventos del reloj (consecutivos) ya revisados; de ellos solo se leen las checadas. */
  leidos: number;
  nuevas: number;
  /** Eventos del reloj que faltan por revisar; `null` hasta que el reloj da la cota. */
  restantes: number | null;
  /** Eventos del reloj a revisar en la corrida; se fija con la cota del inicio. */
  total: number | null;
}

/** Una corrida de sincronización (la última queda en memoria del proceso). */
export interface ChecadorCorrida {
  ok: boolean;
  dispositivoSerie: string | null;
  startedAt: Date;
  finishedAt: Date;
  /** Eventos del reloj revisados (por consecutivo); de ellos solo se leen las checadas. */
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
  /** Checadas del rango en los relojes (se conoce con la primera página de cada búsqueda). */
  total: number | null;
  /** Checadas leídas del rango. */
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

/** Un reloj dado de alta y el estado de su sincronización. */
export interface ChecadorDispositivoStatus {
  dispositivoSerie: string;
  nombre: string;
  url: string;
  /** Si sus checadas arman las entradas/salidas (las puertas de oficina no). */
  asistencia: boolean;
  modelo: string | null;
  ultimoSerialNo: number;
  sincronizadoEn: Date | null;
  checadas: number;
  ultimaChecada: Date | null;
  /** Corrida en curso de este reloj (p. ej. la carga inicial de su historial). */
  enCurso: ChecadorProgreso | null;
  ultimaCorrida: ChecadorCorrida | null;
  /** El reloj rechazó las credenciales: su sincronización automática se detuvo. */
  pausadoPorCredenciales: boolean;
}

export interface ChecadorStatus {
  /** `false` sin `CHECADOR_USER`: no hay con qué conectarse a los relojes. */
  configurado: boolean;
  /** Suma de las corridas en curso de todos los relojes. */
  enCurso: ChecadorProgreso | null;
  /** Importación manual en curso o la última (de todos los relojes). */
  importacion: ChecadorImportacion | null;
  /** Relojes dados de alta. */
  dispositivos: ChecadorDispositivoStatus[];
}
