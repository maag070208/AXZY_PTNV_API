import type { AccessEventType } from "@prisma/client";
import type { ReportPeriod } from "@core/utils/timezone";

/**
 * Entrada para registrar un evento de acceso. El `occurredAt` nunca viene del
 * cliente: lo fija el servidor. `deviceTimestamp` es solo auditoría del reloj
 * del dispositivo.
 */
export interface AccessEventCreateInput {
  /** Payload crudo del QR escaneado (JSON `v:2`). */
  qr?: string;
  /** Alternativa manual al QR: id del empleado (method = MANUAL). */
  employeeId?: string;
  type: AccessEventType;
  siteId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  deviceTimestamp?: string | null;
  /** Idempotencia generada en el dispositivo. */
  clientEventId: string;
  deviceId?: string | null;
  deviceCode?: string | null;
  notes?: string | null;
}

export interface AccessEventFilters {
  employeeId?: string;
  siteId?: string;
  type?: string;
  method?: string;
  start?: string;
  end?: string;
  q?: string;
  includeVoided?: boolean;
}

export interface SiteCreateInput {
  name: string;
  code?: string | null;
  active?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
}

export type SiteUpdateInput = Partial<SiteCreateInput>;

/** Actor autenticado que registra/anula (guardia o admin). */
export interface AccessActor {
  id: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Reporte de entradas/salidas por persona
// ---------------------------------------------------------------------------

/**
 * Incidencia de una sesión derivada del emparejamiento ENTRY/EXIT.
 * - `ENTRY_WITHOUT_EXIT`: entrada que quedó sin salida (incluye la abierta de un
 *   periodo ya cerrado). Es una anomalía.
 * - `EXIT_WITHOUT_ENTRY`: salida sin entrada previa. Es una anomalía.
 * - `OPEN_ENTRY`: entrada abierta de un periodo en curso ("En sitio"). No es error.
 */
export type AccessIncidentCode = "ENTRY_WITHOUT_EXIT" | "EXIT_WITHOUT_ENTRY" | "OPEN_ENTRY";

/** Sesión emparejada (una entrada y su salida). Interna al cálculo. */
export interface AccessReportSession {
  employeeId: string;
  entryAt: Date | null;
  exitAt: Date | null;
  workedMinutes: number;
  incident: AccessIncidentCode | null;
  crossesMidnight: boolean;
}

/** Detalle diario de una persona (atribuido por el día local de su `entryAt`). */
export interface AccessReportDay {
  date: string;
  entryAt: string | null;
  exitAt: string | null;
  workedMinutes: number;
  sessions: number;
  incidents: AccessIncidentCode[];
  /** `true` si alguna sesión del día cruzó la medianoche local. */
  crossesMidnight: boolean;
}

/** Una fila por persona. `days[]` solo se materializa en las filas de la página. */
export interface AccessReportPersonRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  hasRecords: boolean;
  firstEntryAt: string | null;
  lastExitAt: string | null;
  workedMinutes: number;
  sessionCount: number;
  daysWithRecords: number;
  incidents: AccessIncidentCode[];
  days: AccessReportDay[];
}

/** Resumen global del reporte (no depende de la página). */
export interface AccessReportSummary {
  peopleTotal: number;
  peopleWithRecords: number;
  peopleWithoutRecords: number;
  peopleInside: number;
  totalWorkedMinutes: number;
  totalIncidents: number;
  range: { start: string; end: string; timezone: string; period: ReportPeriod };
}

/**
 * Una fila por SESIÓN (una entrada y su salida) del periodo. Es la fila del
 * reporte: una persona con N entradas/salidas genera N filas.
 */
export interface AccessReportSessionRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** Día local (YYYY-MM-DD) al que se atribuye la sesión. */
  date: string;
  entryAt: string | null;
  exitAt: string | null;
  workedMinutes: number;
  incident: AccessIncidentCode | null;
  crossesMidnight: boolean;
}
