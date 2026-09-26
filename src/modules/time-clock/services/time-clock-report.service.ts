import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, paginatedTable, type ITDataTableFetchParams } from "@core/utils/table";
import {
  assertDateKey,
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  type ReportPeriod,
} from "@core/utils/timezone";
import type {
  AccessIncidentCode,
  AccessReportSession,
  AccessReportSummary,
} from "@modules/access/models/entity/access.entity";
import type {
  TimeClockReportResult,
  TimeClockReportSessionRow,
} from "../models/entity/time-clock.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/**
 * Dos checadas del mismo empleado con menos de esto entre sí son la misma
 * checada repetida (en el reloj ~17% de los huecos entre checadas son < 1 min;
 * también quien checa en dos relojes al pasar). Así una checada repetida nunca
 * se vuelve una salida de minutos.
 */
const DUPLICATE_MS = 5 * 60 * 1000;

/**
 * Tope de una jornada: la salida es la última checada antes de que pase esto
 * desde la entrada; si no hay ninguna, la entrada queda sin salida. En los
 * relojes las jornadas duran 3–13 h y los descansos 13–16 h; ver CHECADOR.md §6.
 */
const MAX_WORKDAY_MS = 13 * 60 * 60 * 1000;

/** Días previos que se leen para no empezar a emparejar a media jornada. */
const LOOKBACK_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const universeSelect = {
  id: true,
  name: true,
  employeeNumber: true,
  jobTitle: true,
  active: true,
  department: { select: { id: true, name: true } },
} as const;

/** Persona del reporte: un usuario vinculado o un empleado del reloj sin vincular. */
interface Person {
  /** `userId`, o `reloj:<número>` si aún no está vinculado. */
  id: string;
  name: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  active: boolean;
  linked: boolean;
  /** Números del reloj de la persona (un usuario puede tener más de uno). */
  clockNumbers: string[];
}

interface ReportRange {
  start: Date;
  end: Date;
  timezone: string;
  period: ReportPeriod;
}

/** Quita las checadas repetidas: las que llegan antes de `DUPLICADO_MS` de la última que se quedó. */
const withoutDuplicates = (instants: Date[]): Date[] => {
  const unique: Date[] = [];
  for (const t of instants) {
    const previous = unique[unique.length - 1];
    if (previous && t.getTime() - previous.getTime() < DUPLICATE_MS) continue;
    unique.push(t);
  }
  return unique;
};

/**
 * Entradas/salidas a partir de las checadas de los relojes, con el MISMO
 * contrato que el reporte de acceso (`/access/report`): una fila por sesión y un
 * resumen por persona. La relación con los usuarios es por número de empleado
 * del reloj vía `checador_empleados`; quien checa sin estar vinculado sale
 * igual, con el nombre del reloj y `vinculado: false`.
 *
 * Las checadas de todos los relojes de asistencia se juntan por persona: se
 * puede entrar por uno y salir por otro. Los relojes marcados sin asistencia
 * (puertas de oficina, que se checan varias veces por turno) no cuentan.
 */
export class TimeClockReportService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader
  ) {}

  async report(params: ITDataTableFetchParams) {
    const { rows, summary } = await this.compute(params);
    const from = (params.page - 1) * params.limit;
    return { ...paginatedTable(params, rows.slice(from, from + params.limit), rows.length), summary };
  }

  async reportExport(params: ITDataTableFetchParams) {
    const { rows, summary } = await this.compute(params);
    return { data: rows, total: rows.length, summary };
  }

  // ── Cálculo ────────────────────────────────────────────────────────────────

  private async compute(params: ITDataTableFetchParams): Promise<TimeClockReportResult> {
    const { filters } = params;
    const range = await this.resolveRange(filters);
    const includeInactive = filters.includeInactive === true || filters.includeInactive === "true";
    const fromAttendance = await this.onlyAttendanceClocks();
    const people = this.filter(await this.universe(range, includeInactive, fromAttendance), filters);

    const numbers = people.flatMap((p) => p.clockNumbers);
    const punches =
      numbers.length === 0
        ? []
        : await this.db.timeClockPunch.findMany({
            where: {
              ...fromAttendance,
              employeeNumber: { in: numbers },
              // `OTRO` no es una checada válida (p. ej. minor 104, intento fallido).
              method: { not: "OTHER" },
              occurredAt: {
                gte: new Date(range.start.getTime() - LOOKBACK_DAYS * MS_PER_DAY),
                // Un turno nocturno cierra después del fin del periodo.
                lt: new Date(range.end.getTime() + MS_PER_DAY),
              },
            },
            orderBy: [{ occurredAt: "asc" }, { serialNo: "asc" }],
            select: { employeeNumber: true, occurredAt: true },
          });

    const byNumber = new Map<string, Date[]>();
    for (const c of punches) {
      const list = byNumber.get(c.employeeNumber);
      if (list) list.push(c.occurredAt);
      else byNumber.set(c.employeeNumber, [c.occurredAt]);
    }

    const rows: TimeClockReportSessionRow[] = [];
    const totals = { withRecords: 0, inSite: 0, minutes: 0, incidents: 0 };
    for (const person of people) {
      const instants = person.clockNumbers
        .flatMap((n) => byNumber.get(n) ?? [])
        .sort((a, b) => a.getTime() - b.getTime());
      const sessions = this.match(person.id, withoutDuplicates(instants), range).filter((s) =>
        this.inWindow(s, range)
      );

      sessions.forEach((s, i) => rows.push(this.row(person, s, i, range)));
      const incidents = new Set(sessions.map((s) => s.incident).filter((i): i is AccessIncidentCode => i !== null));
      if (sessions.length > 0) totals.withRecords += 1;
      if (incidents.has("OPEN_ENTRY")) totals.inSite += 1;
      totals.minutes += sessions.reduce((acc, s) => acc + s.workedMinutes, 0);
      totals.incidents += incidents.size;
    }

    const summary: AccessReportSummary = {
      peopleTotal: people.length,
      peopleWithRecords: totals.withRecords,
      peopleWithoutRecords: people.length - totals.withRecords,
      peopleInside: totals.inSite,
      totalWorkedMinutes: totals.minutes,
      totalIncidents: totals.incidents,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: range.period,
      },
    };
    return { rows: this.sort(rows, params.sort), summary };
  }

  /** Resuelve `[start, end)` igual que el reporte de acceso (o lanza 400). */
  private async resolveRange(filters: Record<string, string | number | boolean>): Promise<ReportRange> {
    const period = filters.period;
    if (period !== "DAY" && period !== "WEEK" && period !== "MONTH") {
      throw new HttpError(400, "INVALID_REPORT_PERIOD");
    }
    const dateKey = assertDateKey(filters.date, "INVALID_REPORT_DATE");
    const explicitTz = typeof filters.tz === "string" && filters.tz !== "" ? filters.tz : undefined;
    const timezone = await resolveTimezoneWithConfig(explicitTz, this.sysConfig);
    const { start, end } = resolveReportRange(period, dateKey, timezone);
    return { start, end, timezone, period };
  }

  /**
   * Filtro de checadas que cuentan para entradas/salidas: todas menos las de
   * relojes marcados sin asistencia (una serie sin registro sí cuenta).
   */
  private async onlyAttendanceClocks(): Promise<Prisma.TimeClockPunchWhereInput> {
    const doors = await this.db.timeClock.findMany({
      where: { countsAttendance: false },
      select: { serialNumber: true },
    });
    return doors.length > 0
      ? { clockSerial: { notIn: doors.map((r) => r.serialNumber) } }
      : {};
  }

  /**
   * Universo = usuarios vinculados (activos, o todos con `includeInactive`, o
   * cualquiera que haya checado en el periodo) ∪ empleados del reloj sin
   * vincular que checaron en el periodo.
   */
  private async universe(
    range: ReportRange,
    includeInactive: boolean,
    fromAttendance: Prisma.TimeClockPunchWhereInput
  ): Promise<Person[]> {
    const [links, inPeriod] = await Promise.all([
      this.db.timeClockEmployee.findMany({
        select: { employeeNumber: true, user: { select: universeSelect } },
      }),
      this.db.timeClockPunch.groupBy({
        by: ["employeeNumber"],
        where: { ...fromAttendance, method: { not: "OTHER" }, occurredAt: { gte: range.start, lt: range.end } },
      }),
    ]);
    const punched = new Set(inPeriod.map((c) => c.employeeNumber));

    const byUser = new Map<string, Person>();
    for (const { employeeNumber, user } of links) {
      const person = byUser.get(user.id) ?? {
        id: user.id,
        name: user.name,
        employeeNumber: user.employeeNumber,
        jobTitle: user.jobTitle,
        department: user.department,
        active: user.active,
        linked: true,
        clockNumbers: [],
      };
      person.clockNumbers.push(employeeNumber);
      byUser.set(user.id, person);
    }
    const linkedCount = [...byUser.values()].filter(
      (p) => p.active || includeInactive || p.clockNumbers.some((n) => punched.has(n))
    );

    const withLink = new Set(links.map((v) => v.employeeNumber));
    const withoutLink = [...punched].filter((n) => !withLink.has(n));
    const names = await this.clockNames(withoutLink);
    const fromClock: Person[] = withoutLink.map((n) => ({
      id: `reloj:${n}`,
      name: names.get(n) ?? n,
      employeeNumber: n,
      jobTitle: null,
      department: null,
      active: true,
      linked: false,
      clockNumbers: [n],
    }));

    return [...linkedCount, ...fromClock];
  }

  /** Nombre más reciente de cada número en el reloj. */
  private async clockNames(numbers: string[]): Promise<Map<string, string>> {
    if (numbers.length === 0) return new Map();
    const rows = await this.db.$queryRaw<{ employeeNumber: string; name: string }[]>`
      SELECT "employeeNumber", (array_agg("name" ORDER BY "occurredAt" DESC))[1] AS "name"
      FROM "time_clock_punches"
      WHERE "employeeNumber" IN (${Prisma.join(numbers)})
      GROUP BY "employeeNumber"`;
    return new Map(rows.map((f) => [f.employeeNumber, f.name]));
  }

  private filter(people: Person[], filters: Record<string, string | number | boolean>): Person[] {
    const employeeId = typeof filters.employeeId === "string" ? filters.employeeId : undefined;
    const departmentId = typeof filters.departmentId === "string" ? filters.departmentId : undefined;
    const q = ci(filters.q)?.contains.toLowerCase();

    return people.filter((p) => {
      if (employeeId && p.id !== employeeId) return false;
      if (departmentId && p.department?.id !== departmentId) return false;
      if (q) {
        const text = [p.name, p.employeeNumber, ...p.clockNumbers].filter(Boolean).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }

  /**
   * El reloj no dice si una checada es entrada o salida, y en las puertas de
   * oficina la gente checa varias veces por turno. Por eso cada jornada toma la
   * primera checada como entrada y la última antes del tope como salida; las de
   * en medio no cuentan. La siguiente checada después del tope abre otra
   * jornada. Una entrada sola de hace menos del tope es `OPEN_ENTRY` (en sitio);
   * si ya pasó el tope, `ENTRY_WITHOUT_EXIT`. No hay `EXIT_WITHOUT_ENTRY`: sin
   * tipo, la primera checada siempre es entrada.
   */
  private match(id: string, instants: Date[], range: ReportRange): AccessReportSession[] {
    const sessions: AccessReportSession[] = [];
    for (let i = 0; i < instants.length; ) {
      const entry = instants[i];
      const cap = entry.getTime() + MAX_WORKDAY_MS;
      let last = i;
      while (last + 1 < instants.length && instants[last + 1].getTime() <= cap) last += 1;

      if (last > i) {
        sessions.push(this.session(id, entry, instants[last], null, range.timezone));
      } else {
        const inSite = Date.now() < cap;
        sessions.push(
          this.session(id, entry, null, inSite ? "OPEN_ENTRY" : "ENTRY_WITHOUT_EXIT", range.timezone)
        );
      }
      i = last + 1;
    }
    return sessions;
  }

  private session(
    employeeId: string,
    entryAt: Date | null,
    exitAt: Date | null,
    incident: AccessIncidentCode | null,
    tz: string
  ): AccessReportSession {
    const workedMinutes =
      entryAt && exitAt ? Math.round((exitAt.getTime() - entryAt.getTime()) / MS_PER_MINUTE) : 0;
    const crossesMidnight = Boolean(
      entryAt && exitAt && localDateKey(entryAt, tz) !== localDateKey(exitAt, tz)
    );
    return { employeeId, entryAt, exitAt, workedMinutes, incident, crossesMidnight };
  }

  /** Se atribuye al día local de la entrada (como el reporte de acceso). */
  private inWindow(session: AccessReportSession, range: ReportRange): boolean {
    const anchor = session.entryAt ?? session.exitAt;
    return anchor !== null && anchor >= range.start && anchor < range.end;
  }

  private row(
    person: Person,
    session: AccessReportSession,
    index: number,
    range: ReportRange
  ): TimeClockReportSessionRow {
    const anchor = session.entryAt ?? session.exitAt;
    return {
      id: `${person.id}-${anchor?.getTime() ?? 0}-${index}`,
      employeeId: person.id,
      employeeName: person.name,
      employeeNumber: person.employeeNumber,
      jobTitle: person.jobTitle,
      departmentId: person.department?.id ?? null,
      departmentName: person.department?.name ?? null,
      active: person.active,
      date: anchor ? localDateKey(anchor, range.timezone) : "",
      entryAt: session.entryAt?.toISOString() ?? null,
      exitAt: session.exitAt?.toISOString() ?? null,
      workedMinutes: session.workedMinutes,
      incident: session.incident,
      crossesMidnight: session.crossesMidnight,
      linked: person.linked,
    };
  }

  /** Mismas llaves de orden que el reporte de acceso. */
  private sort(
    rows: TimeClockReportSessionRow[],
    sort: ITDataTableFetchParams["sort"]
  ): TimeClockReportSessionRow[] {
    const sorters: Record<string, (a: TimeClockReportSessionRow, b: TimeClockReportSessionRow) => number> = {
      employeeName: (a, b) => a.employeeName.localeCompare(b.employeeName),
      employeeNumber: (a, b) => (a.employeeNumber ?? "").localeCompare(b.employeeNumber ?? ""),
      departmentName: (a, b) => (a.departmentName ?? "").localeCompare(b.departmentName ?? ""),
      jobTitle: (a, b) => (a.jobTitle ?? "").localeCompare(b.jobTitle ?? ""),
      date: (a, b) => a.date.localeCompare(b.date),
      entryAt: (a, b) => (a.entryAt ?? "").localeCompare(b.entryAt ?? ""),
      exitAt: (a, b) => (a.exitAt ?? "").localeCompare(b.exitAt ?? ""),
      workedMinutes: (a, b) => a.workedMinutes - b.workedMinutes,
    };
    const fallback = (a: TimeClockReportSessionRow, b: TimeClockReportSessionRow): number =>
      a.employeeName.localeCompare(b.employeeName) || (a.entryAt ?? "").localeCompare(b.entryAt ?? "");

    const comparator = (sort ? sorters[sort.key] : undefined) ?? fallback;
    const sorted = [...rows].sort(comparator);
    return sort?.direction === "desc" ? sorted.reverse() : sorted;
  }
}
