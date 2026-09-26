export interface HorarioDiaEntity {
  diaSemana: number;
  entrada: string | null;
  salida: string | null;
  entrada2: string | null;
  salida2: string | null;
  descanso: boolean;
}

/** Una fila del reporte de horas extra (por persona en el periodo). */
export interface HorasExtraRow {
  userId: string;
  employeeName: string;
  numeroEmpleado: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** Nombre del horario vigente (el más reciente del periodo); null si no tiene. */
  horarioNombre: string | null;
  programadasMin: number;
  trabajadasMin: number;
  extraMin: number;
  faltanteMin: number;
  diasConExtra: number;
  /** true si la persona no tiene horario asignado en el periodo. */
  sinHorario: boolean;
  /** Minutos con decisión APROBADO (suma de snapshots). */
  aprobadoMin: number;
  /** Minutos calculados de los días aún sin decisión. */
  pendienteMin: number;
  /** Minutos con decisión RECHAZADO (suma de snapshots). */
  rechazadoMin: number;
  diasAprobados: number;
  diasPendientes: number;
  diasRechazados: number;
}

/**
 * Una fila por (persona, día) del cálculo de tiempo extra. Es la unidad de
 * aprobación: el módulo `overtime` la extiende con el estado de la decisión.
 */
export interface HorasExtraDayRow {
  userId: string;
  employeeName: string;
  numeroEmpleado: string | null;
  departmentId: string | null;
  departmentName: string | null;
  active: boolean;
  /** Día local `YYYY-MM-DD` al que se atribuye el cálculo. */
  date: string;
  extraMin: number;
  workedMin: number;
  programadasMin: number;
  horarioNombre: string | null;
  /** true si el día era de descanso según el horario vigente. */
  descanso: boolean;
  /** true si la persona no tenía horario asignado ese día. */
  sinHorario: boolean;
}

export interface HorasExtraSummary {
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
