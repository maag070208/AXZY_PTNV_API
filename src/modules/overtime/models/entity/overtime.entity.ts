import type { ScheduleOvertimeDay } from "@modules/schedules/models/entity/schedule.entity";

/** Estado de aprobación de un día de tiempo extra. La ausencia de fila = PENDIENTE. */
export type OvertimeDayStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Día de tiempo extra materializado con su decisión (si la hay). */
export interface OvertimeDayRow extends ScheduleOvertimeDay {
  status: OvertimeDayStatus;
  /** Minutos contabilizados: el snapshot aprobado (0 si no está aprobado). */
  approvedExtraMin: number;
  note: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  /** ISO de la decisión; null si sigue pendiente. */
  decidedAt: string | null;
}

/** Resumen del filtro (no depende de la página). */
export interface OvertimeSummary {
  totalDays: number;
  pendingDays: number;
  approvedDays: number;
  rejectedDays: number;
  pendingMinutes: number;
  approvedMinutes: number;
  rejectedMinutes: number;
  /** Personas con al menos un día pendiente. */
  peopleWithPending: number;
  range: { start: string; end: string; timezone: string; period: string };
}
