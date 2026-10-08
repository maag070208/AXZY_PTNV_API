import type { ReportPeriod } from "@core/utils/timezone";

export interface ScheduleDayEntity {
  weekday: number;
  startTime: string | null;
  endTime: string | null;
  splitStartTime: string | null;
  splitEndTime: string | null;
  restDay: boolean;
}

/** Una fila del reporte de horas extra (por persona en el periodo). */
export interface ScheduleOvertimeRow {
  userId: string;
  employeeName: string;
  employeeNumber: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** Nombre del horario vigente (el más reciente del periodo); null si no tiene. */
  scheduleName: string | null;
  scheduledMin: number;
  workedMin: number;
  extraMin: number;
  missingMin: number;
  daysWithExtra: number;
  /** true si la persona no tiene horario asignado en el periodo. */
  withoutSchedule: boolean;
  /** Minutos con decisión APROBADO (suma de snapshots). */
  approvedMin: number;
  /** Minutos calculados de los días aún sin decisión. */
  pendingMin: number;
  /** Minutos con decisión RECHAZADO (suma de snapshots). */
  rejectedMin: number;
  approvedDays: number;
  pendingDays: number;
  rejectedDays: number;
}

/**
 * Una fila por (persona, día) del cálculo de tiempo extra. Es la unidad de
 * aprobación: el módulo `overtime` la extiende con el estado de la decisión.
 */
export interface ScheduleOvertimeDay {
  userId: string;
  employeeName: string;
  employeeNumber: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** Día local `YYYY-MM-DD` al que se atribuye el cálculo. */
  date: string;
  extraMin: number;
  workedMin: number;
  scheduledMin: number;
  scheduleName: string | null;
  /** true si el día era de descanso según el horario vigente. */
  restDay: boolean;
  /** true si la persona no tenía horario asignado ese día. */
  withoutSchedule: boolean;
}

export interface ScheduleOvertimeSummary {
  peopleTotal: number;
  peopleWithExtra: number;
  totalExtraMinutes: number;
  totalWorkedMinutes: number;
  totalScheduledMinutes: number;
  /** Minutos aprobados (lo contabilizado). */
  totalApprovedMinutes: number;
  /** Minutos calculados aún sin decisión. */
  totalPendingMinutes: number;
  /** Minutos rechazados. */
  totalRejectedMinutes: number;
  range: { start: string; end: string; timezone: string; period: string };
}

// ── Reporte semanal de asistencia (RH) ─────────────────────────────────────

/**
 * Estado de un día en el reporte semanal:
 * - `WORKED` jornada sin extra · `OVERTIME` con tiempo extra calculado
 * - `ABSENCE` falta: día laboral pasado sin checadas
 * - `INCOMPLETE` checada sin pareja (entrada sin salida o salida sin entrada)
 * - `REST` descanso · `REST_WORKED` descanso trabajado
 * - `NO_INFO` sin información: sin vínculo al reloj, o hoy todavía sin checadas
 * - `FUTURE` día que aún no llega
 */
export type WeeklyAttendanceDayStatus =
  | "WORKED"
  | "OVERTIME"
  | "ABSENCE"
  | "INCOMPLETE"
  | "REST"
  | "REST_WORKED"
  | "NO_INFO"
  | "FUTURE";

/** Decisión de los jefes sobre el tiempo extra del día (null = no hubo extra). */
export type WeeklyAttendanceApproval = "APPROVED" | "REJECTED" | "PENDING";

export interface WeeklyAttendanceDay {
  date: string;
  status: WeeklyAttendanceDayStatus;
  /** Primera entrada y última salida del día (ISO). */
  entryAt: string | null;
  exitAt: string | null;
  /** Todas las sesiones del día, para el detalle. */
  sessions: Array<{ entryAt: string | null; exitAt: string | null; workedMinutes: number; incident: string | null }>;
  workedMin: number;
  scheduledMin: number;
  extraMin: number;
  missingMin: number;
  /** Retardo (minutos después de la entrada programada, pasada la tolerancia). */
  lateMin: number;
  /** Horario del día ("07:00-15:00"), null en descanso o sin horario. */
  shift: string | null;
  /** Entrada programada del día (ISO), null en descanso o sin horario. */
  scheduledStartAt: string | null;
  approval: WeeklyAttendanceApproval | null;
  /** Minutos aprobados (snapshot de la decisión). */
  approvedExtraMin: number;
}

export interface WeeklyAttendanceTotals {
  workedMin: number;
  scheduledMin: number;
  extraMin: number;
  approvedExtraMin: number;
  pendingExtraMin: number;
  rejectedExtraMin: number;
  missingMin: number;
  absences: number;
  incompleteDays: number;
}

export interface WeeklyAttendanceRow {
  userId: string;
  employeeNumber: string | null;
  /** Números del reloj vinculados (el COD del Excel de RH). */
  clockNumbers: string[];
  name: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  linked: boolean;
  scheduleName: string | null;
  withoutSchedule: boolean;
  days: WeeklyAttendanceDay[];
  totals: WeeklyAttendanceTotals;
}

export interface WeeklyAttendanceReport {
  range: { start: string; end: string; timezone: string; days: string[] };
  rows: WeeklyAttendanceRow[];
  summary: WeeklyAttendanceTotals & { people: number; unlinked: number; withoutSchedule: number };
}

// ---------------------------------------------------------------------------
// Entradas y salidas por persona (POST /schedules/attendance/{time-clock,access})
// ---------------------------------------------------------------------------

/** De qué registros sale la vista por persona. */
export type AttendanceSource = "TIME_CLOCK" | "ACCESS";

/**
 * Estado de un día de una persona contra su horario:
 * - `ATTENDED` registró · `LATE` registró con retardo (pasó la tolerancia)
 * - `ABSENCE` día laboral sin registros (hoy, en cuanto pasa su entrada + tolerancia)
 * - `REST` descanso sin registros · `PENDING` día futuro, o de hoy antes de su entrada
 * - `NO_INFO` sin registros y sin horario (no se sabe si le tocaba)
 */
export type AttendanceDayStatus = "ATTENDED" | "LATE" | "ABSENCE" | "REST" | "PENDING" | "NO_INFO";

/** Incidencia del emparejamiento que deja el día incompleto. */
export type AttendanceDayIncident = "ENTRY_WITHOUT_EXIT" | "EXIT_WITHOUT_ENTRY";

export interface PeopleAttendanceDay {
  date: string;
  status: AttendanceDayStatus;
  /** Primera entrada y última salida del día. */
  entryAt: string | null;
  exitAt: string | null;
  /** Sesiones cerradas + lo que lleva la entrada abierta de las últimas 24 h. */
  workedMinutes: number;
  lateMinutes: number;
  /** Entrada abierta: la persona sigue en sitio. */
  onSite: boolean;
  incident: AttendanceDayIncident | null;
}

export interface PeopleAttendanceRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** `false` = número del reloj sin usuario (solo reloj checador). */
  linked: boolean;
  /** Un día por cada día del periodo, en orden (`summary.range.days`). */
  days: PeopleAttendanceDay[];
  workedMinutes: number;
  onSite: boolean;
  hasRecords: boolean;
  lateDays: number;
  absences: number;
  withoutExit: number;
  withoutEntry: number;
}

/** Vistas rápidas de la tabla (los chips de la pantalla). */
export type PeopleAttendanceView = "ALL" | "INCIDENTS" | "ON_SITE" | "WITHOUT_RECORDS";

/** Totales de todas las personas del filtro (no dependen de la vista ni de la página). */
export interface PeopleAttendanceSummary {
  people: number;
  withRecords: number;
  withoutRecords: number;
  onSite: number;
  workedMinutes: number;
  lateDays: number;
  absences: number;
  withoutExit: number;
  withoutEntry: number;
  range: {
    start: string;
    end: string;
    timezone: string;
    period: ReportPeriod;
    /** Días locales del periodo (`YYYY-MM-DD`). */
    days: string[];
    /** Hoy en la zona del reporte. */
    today: string;
  };
}
