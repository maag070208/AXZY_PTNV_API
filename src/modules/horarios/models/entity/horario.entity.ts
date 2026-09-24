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
}

export interface HorasExtraSummary {
  peopleTotal: number;
  peopleWithExtra: number;
  totalExtraMinutes: number;
  totalWorkedMinutes: number;
  totalScheduledMinutes: number;
  range: { start: string; end: string; timezone: string; period: string };
}
