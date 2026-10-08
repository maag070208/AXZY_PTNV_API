import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { filterEnum, paginatedTable, type ITDataTableFetchParams } from "@core/utils/table";
import { localDateKey } from "@core/utils/timezone";
import type {
  AccessReportPerson,
  AccessReportRange,
  AccessReportSessionRow,
  AccessReportSessions,
} from "@modules/access/models/entity/access.entity";
import { loadScheduleAssignments, scheduleOn, type LoadedAssignment } from "./schedule-assignments";
import { computeWorkday, dateKeyOf, scheduledStartAt, toUtcDate, type Workday, type WorkdaySchedule } from "./workday-rules";
import type {
  AttendanceDayStatus,
  AttendanceSource,
  PeopleAttendanceDay,
  PeopleAttendanceRow,
  PeopleAttendanceSummary,
  PeopleAttendanceView,
} from "../models/entity/schedule.entity";

/** Lo que la vista necesita de cada fuente: el reporte de acceso o el del reloj checador. */
export interface AttendanceSessionSource {
  sessions(params: ITDataTableFetchParams): Promise<AccessReportSessions>;
}

const VIEWS: readonly PeopleAttendanceView[] = ["ALL", "INCIDENTS", "ON_SITE", "WITHOUT_RECORDS"];

const IN_VIEW: Record<PeopleAttendanceView, (row: PeopleAttendanceRow) => boolean> = {
  ALL: () => true,
  INCIDENTS: (r) => r.lateDays + r.absences + r.withoutExit + r.withoutEntry > 0,
  ON_SITE: (r) => r.onSite,
  WITHOUT_RECORDS: (r) => !r.hasRecords,
};

const SORTERS: Record<string, (a: PeopleAttendanceRow, b: PeopleAttendanceRow) => number> = {
  employeeName: (a, b) => a.employeeName.localeCompare(b.employeeName),
  workedMinutes: (a, b) => a.workedMinutes - b.workedMinutes,
};

/**
 * Una entrada abierta suma lo que lleva transcurrido solo si empezó hace menos
 * de esto (en el reloj una jornada abierta dura máximo 13 h; en la bitácora una
 * entrada olvidada de hace días no debe inflar las horas).
 */
const LIVE_ENTRY_MAX_MS = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const addDays = (dayKey: string, days: number): string => {
  const d = toUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyOf(d);
};

/** Días locales de `[start, end)`. */
const daysOf = (range: AccessReportRange): string[] => {
  const last = localDateKey(new Date(range.end.getTime() - 1), range.timezone);
  const days: string[] = [];
  for (let day = localDateKey(range.start, range.timezone); day <= last; day = addDays(day, 1)) days.push(day);
  return days;
};

/**
 * Entradas y salidas por PERSONA: una fila por persona del universo (con o sin
 * registros) con cada día del periodo calificado contra su horario (asistió,
 * retardo, falta, descanso), sus horas y si sigue en sitio. Es la pantalla de
 * Entradas y salidas de RH; el detalle por sesión sigue en los exports.
 *
 * Las sesiones salen de la fuente (bitácora de acceso o reloj checador, mismo
 * contrato) y el retardo de `computeWorkday`, la regla de Pre nómina y horas
 * extra, así que los tres cuentan igual.
 */
export class PeopleAttendanceService {
  constructor(
    private readonly sources: Record<AttendanceSource, AttendanceSessionSource>,
    private readonly db: PrismaClient = prismaClient,
    private readonly clock: () => number = Date.now
  ) {}

  async report(source: AttendanceSource, params: ITDataTableFetchParams) {
    const view = filterEnum(params.filters, "view", VIEWS) ?? "ALL";
    const { people, rows, range } = await this.sources[source].sessions(params);
    const now = this.clock();
    const today = localDateKey(new Date(now), range.timezone);
    const days = daysOf(range);

    const sessionsByDay = new Map<string, AccessReportSessionRow[]>();
    for (const session of rows) {
      const key = `${session.employeeId}|${session.date}`;
      sessionsByDay.set(key, [...(sessionsByDay.get(key) ?? []), session]);
    }
    // Los números del reloj sin usuario (`reloj:<n>`) no tienen horario.
    const assignments = await loadScheduleAssignments(
      this.db,
      people.filter((p) => p.linked !== false).map((p) => p.id),
      range
    );

    const all = people.map((person) =>
      this.row(person, days, (day) => sessionsByDay.get(`${person.id}|${day}`) ?? [], assignments, {
        timezone: range.timezone,
        today,
        now,
      })
    );
    // La dirección aplica a la columna elegida; los empates siempre van por nombre.
    const comparator = (params.sort && SORTERS[params.sort.key]) ?? SORTERS.employeeName;
    const direction = params.sort?.direction === "desc" ? -1 : 1;
    const visible = all
      .filter(IN_VIEW[view])
      .sort((a, b) => direction * comparator(a, b) || a.employeeName.localeCompare(b.employeeName));

    const from = (params.page - 1) * params.limit;
    return {
      ...paginatedTable(params, visible.slice(from, from + params.limit), visible.length),
      summary: this.summary(all, range, days, today),
    };
  }

  private row(
    person: AccessReportPerson,
    days: string[],
    sessionsOf: (day: string) => AccessReportSessionRow[],
    assignments: LoadedAssignment[],
    at: { timezone: string; today: string; now: number }
  ): PeopleAttendanceRow {
    const personDays = days.map((date): PeopleAttendanceDay => {
      const sessions = sessionsOf(date);
      const schedule = person.linked === false ? null : scheduleOn(assignments, person.id, date);
      const workday = computeWorkday(date, sessions, schedule, at.timezone);
      const open = sessions.find((s) => s.incident === "OPEN_ENTRY" && s.entryAt);
      const openFor = open?.entryAt ? at.now - Date.parse(open.entryAt) : 0;
      const entries = sessions.flatMap((s) => (s.entryAt ? [s.entryAt] : [])).sort();
      const exits = sessions.flatMap((s) => (s.exitAt ? [s.exitAt] : [])).sort();
      const has = (incident: AccessReportSessionRow["incident"]) => sessions.some((s) => s.incident === incident);
      return {
        date,
        status: dayStatus(date, sessions.length > 0, workday, schedule, at),
        entryAt: entries[0] ?? null,
        // Mientras sigue en sitio no hay salida que mostrar.
        exitAt: open ? null : exits[exits.length - 1] ?? null,
        workedMinutes:
          workday.workedMin + (openFor > 0 && openFor < LIVE_ENTRY_MAX_MS ? Math.round(openFor / MS_PER_MINUTE) : 0),
        lateMinutes: workday.lateMin,
        onSite: Boolean(open),
        incident: has("ENTRY_WITHOUT_EXIT") ? "ENTRY_WITHOUT_EXIT" : has("EXIT_WITHOUT_ENTRY") ? "EXIT_WITHOUT_ENTRY" : null,
      };
    });

    const count = (match: (d: PeopleAttendanceDay) => boolean) => personDays.filter(match).length;
    return {
      employeeId: person.id,
      employeeName: person.name,
      employeeNumber: person.employeeNumber,
      jobTitle: person.jobTitle,
      departmentId: person.department?.id ?? null,
      departmentName: person.department?.name ?? null,
      active: person.active,
      linked: person.linked !== false,
      days: personDays,
      workedMinutes: personDays.reduce((acc, d) => acc + d.workedMinutes, 0),
      onSite: personDays.some((d) => d.onSite),
      hasRecords: count((d) => d.status === "ATTENDED" || d.status === "LATE") > 0,
      lateDays: count((d) => d.status === "LATE"),
      absences: count((d) => d.status === "ABSENCE"),
      withoutExit: count((d) => d.incident === "ENTRY_WITHOUT_EXIT"),
      withoutEntry: count((d) => d.incident === "EXIT_WITHOUT_ENTRY"),
    };
  }

  private summary(
    rows: PeopleAttendanceRow[],
    range: AccessReportRange,
    days: string[],
    today: string
  ): PeopleAttendanceSummary {
    const sum = (pick: (r: PeopleAttendanceRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
    const withRecords = rows.filter((r) => r.hasRecords).length;
    return {
      people: rows.length,
      withRecords,
      withoutRecords: rows.length - withRecords,
      onSite: rows.filter((r) => r.onSite).length,
      workedMinutes: sum((r) => r.workedMinutes),
      lateDays: sum((r) => r.lateDays),
      absences: sum((r) => r.absences),
      withoutExit: sum((r) => r.withoutExit),
      withoutEntry: sum((r) => r.withoutEntry),
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: range.period,
        days,
        today,
      },
    };
  }
}

/** Califica un día contra el horario (ver `AttendanceDayStatus`). */
const dayStatus = (
  date: string,
  hasSessions: boolean,
  workday: Workday,
  schedule: WorkdaySchedule | null,
  at: { timezone: string; today: string; now: number }
): AttendanceDayStatus => {
  if (hasSessions) return workday.lateMin > 0 ? "LATE" : "ATTENDED";
  if (date > at.today) return "PENDING";
  if (workday.withoutSchedule) return "NO_INFO";
  if (workday.restDay) return "REST";
  if (date < at.today) return "ABSENCE";
  // Hoy: es falta en cuanto pasa su entrada más la tolerancia sin registrar.
  const start = scheduledStartAt(schedule, date, at.timezone);
  const tolerance = (schedule?.entryToleranceMin ?? 0) * MS_PER_MINUTE;
  return start && at.now > start.getTime() + tolerance ? "ABSENCE" : "PENDING";
};
