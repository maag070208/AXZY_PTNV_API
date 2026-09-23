import type { PrismaClient, Role } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, paginatedTable, type ITDataTableFetchParams } from "@core/utils/table";
import {
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  assertDateKey,
  type ReportPeriod,
} from "@core/utils/timezone";
import type { SysConfigReader } from "./access.service";
import type {
  AccessIncidentCode,
  AccessReportDay,
  AccessReportPersonRow,
  AccessReportSession,
  AccessReportSummary,
} from "../models/entity/access.entity";

/** Roles que forman el roster de personal (mismo criterio que `personal`). */
const PERSONAL_ROLES: Role[] = ["GERENTE", "JEFE_DE_AREA", "EMPLEADO"];

/**
 * Días de lookback para cargar eventos previos al periodo. Sin esto, una
 * entrada de ayer con salida hoy se leería como `EXIT_WITHOUT_ENTRY`.
 */
const LOOKBACK_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const universeSelect = {
  id: true,
  name: true,
  numeroEmpleado: true,
  puesto: true,
  active: true,
  department: { select: { id: true, name: true } },
} as const;

type UniverseUser = {
  id: string;
  name: string;
  numeroEmpleado: string | null;
  puesto: string | null;
  active: boolean;
  department: { id: string; name: string } | null;
};

type EventRow = {
  id: string;
  employeeId: string;
  type: "ENTRY" | "EXIT";
  occurredAt: Date;
};

interface ReportRange {
  start: Date;
  end: Date;
  timezone: string;
  period: ReportPeriod;
}

export interface AccessReportResponse {
  data: AccessReportPersonRow[];
  total: number;
  page: number;
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  summary: AccessReportSummary;
}

export interface AccessReportExportResponse {
  data: AccessReportPersonRow[];
  total: number;
  summary: AccessReportSummary;
}

/**
 * Reporte de entradas/salidas agrupado por persona.
 *
 * El emparejamiento ENTRY/EXIT es SECUENCIAL (una entrada abierta a la vez), así
 * que no se puede expresar con `groupBy` ni SQL agregado sin perder las
 * incidencias. El volumen es bajo (personas × eventos de un periodo acotado), por
 * lo que se resuelve en memoria con un `findMany` ordenado. Si el volumen crece,
 * este es el punto a revisar.
 */
export class AccessReportService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: SysConfigReader
  ) {}

  async report(params: ITDataTableFetchParams): Promise<AccessReportResponse> {
    const { rows, sessionsByEmployee, range } = await this.computeRows(params);
    const sorted = this.sortRows(rows, params.sort);
    const summary = this.buildSummary(sorted, range);

    // `days[]` solo se materializa para las filas de la página devuelta.
    const from = (params.page - 1) * params.limit;
    const pageRows = sorted
      .slice(from, from + params.limit)
      .map((row) => ({ ...row, days: this.buildDays(sessionsByEmployee.get(row.employeeId) ?? [], range) }));

    return { ...paginatedTable(params, pageRows, sorted.length), summary };
  }

  async reportExport(params: ITDataTableFetchParams): Promise<AccessReportExportResponse> {
    const { rows, sessionsByEmployee, range } = await this.computeRows(params);
    const sorted = this.sortRows(rows, params.sort);
    const summary = this.buildSummary(sorted, range);
    const data = sorted.map((row) => ({
      ...row,
      days: this.buildDays(sessionsByEmployee.get(row.employeeId) ?? [], range),
    }));
    return { data, total: data.length, summary };
  }

  // ---------------------------------------------------------------------------
  // Cálculo
  // ---------------------------------------------------------------------------

  private async computeRows(params: ITDataTableFetchParams): Promise<{
    rows: AccessReportPersonRow[];
    sessionsByEmployee: Map<string, AccessReportSession[]>;
    range: ReportRange;
  }> {
    const { filters } = params;
    const range = await this.resolveRange(filters);

    const universe = await this.buildUniverse(range.start, range.end, this.includeInactive(filters));
    const people = this.applyPersonFilters(universe, filters);

    if (people.length === 0) {
      return { rows: [], sessionsByEmployee: new Map(), range };
    }

    const lookbackStart = new Date(range.start.getTime() - LOOKBACK_DAYS * MS_PER_DAY);
    // Tail de un día: un turno nocturno cierra después del fin del periodo, y su
    // sesión debe atribuirse al día de la entrada con la duración completa.
    const lookaheadEnd = new Date(range.end.getTime() + MS_PER_DAY);
    const events = await this.loadEvents(
      people.map((p) => p.id),
      lookbackStart,
      lookaheadEnd
    );

    const eventsByEmployee = new Map<string, EventRow[]>();
    for (const event of events) {
      const list = eventsByEmployee.get(event.employeeId);
      if (list) list.push(event);
      else eventsByEmployee.set(event.employeeId, [event]);
    }

    const sessionsByEmployee = new Map<string, AccessReportSession[]>();
    const rows = people.map((person) => {
      const sessions = this.pair(
        person.id,
        eventsByEmployee.get(person.id) ?? [],
        range
      );
      sessionsByEmployee.set(person.id, sessions);
      return this.aggregate(person, sessions, range);
    });

    return { rows, sessionsByEmployee, range };
  }

  private includeInactive(filters: Record<string, string | number | boolean>): boolean {
    return filters.includeInactive === true || filters.includeInactive === "true";
  }

  /** Resuelve `[start, end)` en la zona horaria oficial (o lanza 400). */
  private async resolveRange(filters: Record<string, string | number | boolean>): Promise<ReportRange> {
    const rawPeriod = filters.period;
    if (rawPeriod !== "DAY" && rawPeriod !== "WEEK" && rawPeriod !== "MONTH") {
      throw new HttpError(400, {
        code: "INVALID_REPORT_PERIOD",
        message: "period debe ser DAY, WEEK o MONTH",
      });
    }
    const dateKey = assertDateKey(filters.date, "INVALID_REPORT_DATE");

    const explicitTz = typeof filters.tz === "string" && filters.tz !== "" ? filters.tz : undefined;
    const timezone = await this.resolveTimezone(explicitTz);

    const { start, end } = resolveReportRange(rawPeriod, dateKey, timezone);
    return { start, end, timezone, period: rawPeriod };
  }

  /**
   * Precedencia: `filters.tz` → `sys_config.ACCESS_REPORT_TIMEZONE` → env TZ →
   * `America/Mexico_City`. Un `tz` explícito inválido es 400. Comparte el
   * resolver con `AccessService.table()`/`meToday()` para que bitácora y
   * reporte calculen el MISMO boundary.
   */
  private resolveTimezone(explicit?: string): Promise<string> {
    return resolveTimezoneWithConfig(explicit, this.sysConfig);
  }

  /**
   * Universo = roster activo (o completo si `includeInactive`) ∪ cualquier
   * usuario con al menos un evento no anulado en el periodo. Se resuelve con dos
   * consultas y una unión en memoria para no depender del nombre de la
   * back-relation de `AccessEvent.employee`.
   */
  private async buildUniverse(
    start: Date,
    end: Date,
    includeInactive: boolean
  ): Promise<UniverseUser[]> {
    const roster = await this.db.user.findMany({
      where: {
        role: { in: PERSONAL_ROLES },
        ...(includeInactive ? {} : { active: true }),
      },
      select: universeSelect,
      orderBy: { name: "asc" },
    });

    const withEvents = await this.db.accessEvent.findMany({
      where: { voidedAt: null, occurredAt: { gte: start, lt: end } },
      distinct: ["employeeId"],
      select: { employeeId: true },
    });

    const known = new Set(roster.map((u) => u.id));
    const missingIds = withEvents.map((e) => e.employeeId).filter((id) => !known.has(id));
    if (missingIds.length === 0) return roster;

    const extra = await this.db.user.findMany({
      where: { id: { in: missingIds } },
      select: universeSelect,
      orderBy: { name: "asc" },
    });
    return [...roster, ...extra];
  }

  private applyPersonFilters(
    universe: UniverseUser[],
    filters: Record<string, string | number | boolean>
  ): UniverseUser[] {
    const employeeId = typeof filters.employeeId === "string" ? filters.employeeId : undefined;
    const departmentId = typeof filters.departmentId === "string" ? filters.departmentId : undefined;
    const q = ci(filters.q);

    return universe.filter((person) => {
      if (employeeId && person.id !== employeeId) return false;
      if (departmentId && person.department?.id !== departmentId) return false;
      if (q) {
        const name = person.name.toLowerCase();
        const number = (person.numeroEmpleado ?? "").toLowerCase();
        if (!name.includes(q.contains.toLowerCase()) && !number.includes(q.contains.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }

  /** Eventos no anulados de `[from, to)`, ordenados para el emparejamiento. */
  private async loadEvents(employeeIds: string[], from: Date, to: Date): Promise<EventRow[]> {
    return this.db.accessEvent.findMany({
      where: {
        employeeId: { in: employeeIds },
        voidedAt: null,
        occurredAt: { gte: from, lt: to },
      },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, employeeId: true, type: true, occurredAt: true },
    });
  }

  /**
   * Empareja eventos en sesiones (una entrada abierta a la vez):
   * ENTRY abre; EXIT cierra; ENTRY con entrada abierta cierra la anterior como
   * `ENTRY_WITHOUT_EXIT` y abre otra; EXIT sin entrada es `EXIT_WITHOUT_ENTRY`.
   * Al final, una entrada abierta es `OPEN_ENTRY` si el periodo sigue en curso y
   * su `entryAt` cae dentro; si no, `ENTRY_WITHOUT_EXIT`.
   */
  private pair(employeeId: string, events: EventRow[], range: ReportRange): AccessReportSession[] {
    const sessions: AccessReportSession[] = [];
    let openEntryAt: Date | null = null;

    for (const event of events) {
      if (event.type === "ENTRY") {
        if (openEntryAt) {
          sessions.push(this.makeSession(employeeId, openEntryAt, null, "ENTRY_WITHOUT_EXIT", range.timezone));
        }
        openEntryAt = event.occurredAt;
      } else if (openEntryAt) {
        sessions.push(this.makeSession(employeeId, openEntryAt, event.occurredAt, null, range.timezone));
        openEntryAt = null;
      } else {
        sessions.push(this.makeSession(employeeId, null, event.occurredAt, "EXIT_WITHOUT_ENTRY", range.timezone));
      }
    }

    if (openEntryAt) {
      const withinPeriod = openEntryAt >= range.start && openEntryAt < range.end;
      const periodOngoing = range.end.getTime() > Date.now();
      const incident: AccessIncidentCode =
        withinPeriod && periodOngoing ? "OPEN_ENTRY" : "ENTRY_WITHOUT_EXIT";
      sessions.push(this.makeSession(employeeId, openEntryAt, null, incident, range.timezone));
    }

    return sessions;
  }

  private makeSession(
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

  /** Atribuye por el día local del `entryAt` (o del `exitAt` si es huérfana). */
  private inWindow(session: AccessReportSession, range: ReportRange): boolean {
    const anchor = session.entryAt ?? session.exitAt;
    return anchor !== null && anchor >= range.start && anchor < range.end;
  }

  private aggregate(
    person: UniverseUser,
    sessions: AccessReportSession[],
    range: ReportRange
  ): AccessReportPersonRow {
    const inWindow = sessions.filter((s) => this.inWindow(s, range));

    let workedMinutes = 0;
    let firstEntryAt: Date | null = null;
    let lastExitAt: Date | null = null;
    const incidents = new Set<AccessIncidentCode>();
    const days = new Set<string>();

    for (const session of inWindow) {
      workedMinutes += session.workedMinutes;
      if (session.entryAt && (!firstEntryAt || session.entryAt < firstEntryAt)) firstEntryAt = session.entryAt;
      if (session.exitAt && (!lastExitAt || session.exitAt > lastExitAt)) lastExitAt = session.exitAt;
      if (session.incident) incidents.add(session.incident);
      const anchor = session.entryAt ?? session.exitAt;
      if (anchor) days.add(localDateKey(anchor, range.timezone));
    }

    return {
      employeeId: person.id,
      employeeName: person.name,
      numeroEmpleado: person.numeroEmpleado,
      puesto: person.puesto,
      departmentId: person.department?.id ?? null,
      departmentName: person.department?.name ?? null,
      active: person.active,
      hasRecords: inWindow.length > 0,
      firstEntryAt: firstEntryAt?.toISOString() ?? null,
      lastExitAt: lastExitAt?.toISOString() ?? null,
      workedMinutes,
      sessionCount: inWindow.length,
      daysWithRecords: days.size,
      incidents: [...incidents],
      days: [],
    };
  }

  private buildDays(sessions: AccessReportSession[], range: ReportRange): AccessReportDay[] {
    const byDay = new Map<
      string,
      {
        entryAt: Date | null;
        exitAt: Date | null;
        workedMinutes: number;
        sessions: number;
        incidents: Set<AccessIncidentCode>;
        crossesMidnight: boolean;
      }
    >();

    for (const session of sessions.filter((s) => this.inWindow(s, range))) {
      const anchor = session.entryAt ?? session.exitAt;
      if (!anchor) continue;
      const key = localDateKey(anchor, range.timezone);
      const day =
        byDay.get(key) ??
        {
          entryAt: null,
          exitAt: null,
          workedMinutes: 0,
          sessions: 0,
          incidents: new Set<AccessIncidentCode>(),
          crossesMidnight: false,
        };
      if (session.entryAt && (!day.entryAt || session.entryAt < day.entryAt)) day.entryAt = session.entryAt;
      if (session.exitAt && (!day.exitAt || session.exitAt > day.exitAt)) day.exitAt = session.exitAt;
      day.workedMinutes += session.workedMinutes;
      day.sessions += 1;
      if (session.incident) day.incidents.add(session.incident);
      if (session.crossesMidnight) day.crossesMidnight = true;
      byDay.set(key, day);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        entryAt: day.entryAt?.toISOString() ?? null,
        exitAt: day.exitAt?.toISOString() ?? null,
        workedMinutes: day.workedMinutes,
        sessions: day.sessions,
        incidents: [...day.incidents],
        crossesMidnight: day.crossesMidnight,
      }));
  }

  private sortRows(
    rows: AccessReportPersonRow[],
    sort: ITDataTableFetchParams["sort"]
  ): AccessReportPersonRow[] {
    const sorters: Record<string, (a: AccessReportPersonRow, b: AccessReportPersonRow) => number> = {
      employeeName: (a, b) => a.employeeName.localeCompare(b.employeeName),
      numeroEmpleado: (a, b) => (a.numeroEmpleado ?? "").localeCompare(b.numeroEmpleado ?? ""),
      departmentName: (a, b) => (a.departmentName ?? "").localeCompare(b.departmentName ?? ""),
      workedMinutes: (a, b) => a.workedMinutes - b.workedMinutes,
      sessionCount: (a, b) => a.sessionCount - b.sessionCount,
      daysWithRecords: (a, b) => a.daysWithRecords - b.daysWithRecords,
      firstEntryAt: (a, b) => (a.firstEntryAt ?? "").localeCompare(b.firstEntryAt ?? ""),
      lastExitAt: (a, b) => (a.lastExitAt ?? "").localeCompare(b.lastExitAt ?? ""),
      active: (a, b) => Number(a.active) - Number(b.active),
      hasRecords: (a, b) => Number(a.hasRecords) - Number(b.hasRecords),
    };

    const fallback = (a: AccessReportPersonRow, b: AccessReportPersonRow): number =>
      a.employeeName.localeCompare(b.employeeName);

    // Clave fuera del allowlist → fallback por nombre, pero la dirección que
    // pidió el cliente SIEMPRE se respeta (incluido el fallback).
    const comparator = (sort ? sorters[sort.key] : undefined) ?? fallback;
    const sorted = [...rows].sort(comparator);
    return sort?.direction === "desc" ? sorted.reverse() : sorted;
  }

  private buildSummary(rows: AccessReportPersonRow[], range: ReportRange): AccessReportSummary {
    let peopleWithRecords = 0;
    let peopleInside = 0;
    let totalWorkedMinutes = 0;
    let totalIncidents = 0;

    for (const row of rows) {
      if (row.hasRecords) peopleWithRecords += 1;
      if (row.incidents.includes("OPEN_ENTRY")) peopleInside += 1;
      totalWorkedMinutes += row.workedMinutes;
      totalIncidents += row.incidents.length;
    }

    return {
      peopleTotal: rows.length,
      peopleWithRecords,
      peopleWithoutRecords: rows.length - peopleWithRecords,
      peopleInside,
      totalWorkedMinutes,
      totalIncidents,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: range.period,
      },
    };
  }
}
