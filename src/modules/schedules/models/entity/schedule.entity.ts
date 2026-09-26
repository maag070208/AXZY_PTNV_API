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
