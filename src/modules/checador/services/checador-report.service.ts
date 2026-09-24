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
  ChecadorReportResult,
  ChecadorReportSessionRow,
} from "../models/entity/checador.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/**
 * Dos checadas del mismo empleado con menos de esto entre sí son la misma
 * checada repetida (en el reloj ~17% de los huecos entre checadas son < 1 min).
 */
const DUPLICADO_MS = 5 * 60 * 1000;

/**
 * Tope de una jornada: si la siguiente checada llega después, la entrada queda
 * sin salida y esa checada abre otra jornada. En este reloj las jornadas duran
 * 3–13 h y los descansos 13–16 h; ver CHECADOR.md §5.
 */
const MAX_JORNADA_MS = 13 * 60 * 60 * 1000;

/** Días previos que se leen para no empezar a emparejar a media jornada. */
const LOOKBACK_DAYS = 3;

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

/** Persona del reporte: un usuario vinculado o un empleado del reloj sin vincular. */
interface Persona {
  /** `userId`, o `reloj:<número>` si aún no está vinculado. */
  id: string;
  name: string;
  numeroEmpleado: string | null;
  puesto: string | null;
  department: { id: string; name: string } | null;
  active: boolean;
  vinculado: boolean;
  /** Números del reloj de la persona (un usuario puede tener más de uno). */
  numerosReloj: string[];
}

interface ReportRange {
  start: Date;
  end: Date;
  timezone: string;
  period: ReportPeriod;
}

/** Quita las checadas repetidas: las que llegan antes de `DUPLICADO_MS` de la última que se quedó. */
const sinDuplicados = (instantes: Date[]): Date[] => {
  const unicos: Date[] = [];
  for (const t of instantes) {
    const anterior = unicos[unicos.length - 1];
    if (anterior && t.getTime() - anterior.getTime() < DUPLICADO_MS) continue;
    unicos.push(t);
  }
  return unicos;
};

/**
 * Entradas/salidas a partir de las checadas del reloj, con el MISMO contrato
 * que el reporte de acceso (`/access/report`): una fila por sesión y un resumen
 * por persona. La relación con los usuarios es por número de empleado del reloj
 * vía `checador_empleados`; quien checa sin estar vinculado sale igual, con el
 * nombre del reloj y `vinculado: false`.
 */
export class ChecadorReportService {
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

  private async compute(params: ITDataTableFetchParams): Promise<ChecadorReportResult> {
    const { filters } = params;
    const range = await this.resolveRange(filters);
    const includeInactive = filters.includeInactive === true || filters.includeInactive === "true";
    const personas = this.filtrar(await this.universo(range, includeInactive), filters);

    const numeros = personas.flatMap((p) => p.numerosReloj);
    const checadas =
      numeros.length === 0
        ? []
        : await this.db.checada.findMany({
            where: {
              numeroEmpleado: { in: numeros },
              // `OTRO` no es una checada válida (p. ej. minor 104, intento fallido).
              metodo: { not: "OTRO" },
              occurredAt: {
                gte: new Date(range.start.getTime() - LOOKBACK_DAYS * MS_PER_DAY),
                // Un turno nocturno cierra después del fin del periodo.
                lt: new Date(range.end.getTime() + MS_PER_DAY),
              },
            },
            orderBy: [{ occurredAt: "asc" }, { serialNo: "asc" }],
            select: { numeroEmpleado: true, occurredAt: true },
          });

    const porNumero = new Map<string, Date[]>();
    for (const c of checadas) {
      const lista = porNumero.get(c.numeroEmpleado);
      if (lista) lista.push(c.occurredAt);
      else porNumero.set(c.numeroEmpleado, [c.occurredAt]);
    }

    const rows: ChecadorReportSessionRow[] = [];
    const resumen = { conRegistros: 0, enSitio: 0, minutos: 0, incidencias: 0 };
    for (const persona of personas) {
      const instantes = persona.numerosReloj
        .flatMap((n) => porNumero.get(n) ?? [])
        .sort((a, b) => a.getTime() - b.getTime());
      const sesiones = this.emparejar(persona.id, sinDuplicados(instantes), range).filter((s) =>
        this.inWindow(s, range)
      );

      sesiones.forEach((s, i) => rows.push(this.fila(persona, s, i, range)));
      const incidencias = new Set(sesiones.map((s) => s.incident).filter((i): i is AccessIncidentCode => i !== null));
      if (sesiones.length > 0) resumen.conRegistros += 1;
      if (incidencias.has("OPEN_ENTRY")) resumen.enSitio += 1;
      resumen.minutos += sesiones.reduce((acc, s) => acc + s.workedMinutes, 0);
      resumen.incidencias += incidencias.size;
    }

    const summary: AccessReportSummary = {
      peopleTotal: personas.length,
      peopleWithRecords: resumen.conRegistros,
      peopleWithoutRecords: personas.length - resumen.conRegistros,
      peopleInside: resumen.enSitio,
      totalWorkedMinutes: resumen.minutos,
      totalIncidents: resumen.incidencias,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: range.period,
      },
    };
    return { rows: this.ordenar(rows, params.sort), summary };
  }

  /** Resuelve `[start, end)` igual que el reporte de acceso (o lanza 400). */
  private async resolveRange(filters: Record<string, string | number | boolean>): Promise<ReportRange> {
    const period = filters.period;
    if (period !== "DAY" && period !== "WEEK" && period !== "MONTH") {
      throw new HttpError(400, { code: "INVALID_REPORT_PERIOD", message: "period debe ser DAY, WEEK o MONTH" });
    }
    const dateKey = assertDateKey(filters.date, "INVALID_REPORT_DATE");
    const explicitTz = typeof filters.tz === "string" && filters.tz !== "" ? filters.tz : undefined;
    const timezone = await resolveTimezoneWithConfig(explicitTz, this.sysConfig);
    const { start, end } = resolveReportRange(period, dateKey, timezone);
    return { start, end, timezone, period };
  }

  /**
   * Universo = usuarios vinculados (activos, o todos con `includeInactive`, o
   * cualquiera que haya checado en el periodo) ∪ empleados del reloj sin
   * vincular que checaron en el periodo.
   */
  private async universo(range: ReportRange, includeInactive: boolean): Promise<Persona[]> {
    const [vinculos, enPeriodo] = await Promise.all([
      this.db.checadorEmpleado.findMany({
        select: { numeroEmpleado: true, user: { select: universeSelect } },
      }),
      this.db.checada.groupBy({
        by: ["numeroEmpleado"],
        where: { metodo: { not: "OTRO" }, occurredAt: { gte: range.start, lt: range.end } },
      }),
    ]);
    const checaron = new Set(enPeriodo.map((c) => c.numeroEmpleado));

    const porUsuario = new Map<string, Persona>();
    for (const { numeroEmpleado, user } of vinculos) {
      const persona = porUsuario.get(user.id) ?? {
        id: user.id,
        name: user.name,
        numeroEmpleado: user.numeroEmpleado,
        puesto: user.puesto,
        department: user.department,
        active: user.active,
        vinculado: true,
        numerosReloj: [],
      };
      persona.numerosReloj.push(numeroEmpleado);
      porUsuario.set(user.id, persona);
    }
    const vinculados = [...porUsuario.values()].filter(
      (p) => p.active || includeInactive || p.numerosReloj.some((n) => checaron.has(n))
    );

    const conVinculo = new Set(vinculos.map((v) => v.numeroEmpleado));
    const sinVincular = [...checaron].filter((n) => !conVinculo.has(n));
    const nombres = await this.nombresDelReloj(sinVincular);
    const delReloj: Persona[] = sinVincular.map((n) => ({
      id: `reloj:${n}`,
      name: nombres.get(n) ?? n,
      numeroEmpleado: n,
      puesto: null,
      department: null,
      active: true,
      vinculado: false,
      numerosReloj: [n],
    }));

    return [...vinculados, ...delReloj];
  }

  /** Nombre más reciente de cada número en el reloj. */
  private async nombresDelReloj(numeros: string[]): Promise<Map<string, string>> {
    if (numeros.length === 0) return new Map();
    const filas = await this.db.$queryRaw<{ numeroEmpleado: string; nombre: string }[]>`
      SELECT "numeroEmpleado", (array_agg("nombre" ORDER BY "occurredAt" DESC))[1] AS "nombre"
      FROM "checadas"
      WHERE "numeroEmpleado" IN (${Prisma.join(numeros)})
      GROUP BY "numeroEmpleado"`;
    return new Map(filas.map((f) => [f.numeroEmpleado, f.nombre]));
  }

  private filtrar(personas: Persona[], filters: Record<string, string | number | boolean>): Persona[] {
    const employeeId = typeof filters.employeeId === "string" ? filters.employeeId : undefined;
    const departmentId = typeof filters.departmentId === "string" ? filters.departmentId : undefined;
    const q = ci(filters.q)?.contains.toLowerCase();

    return personas.filter((p) => {
      if (employeeId && p.id !== employeeId) return false;
      if (departmentId && p.department?.id !== departmentId) return false;
      if (q) {
        const texto = [p.name, p.numeroEmpleado, ...p.numerosReloj].filter(Boolean).join(" ").toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }

  /**
   * El reloj no dice si una checada es entrada o salida: se alternan en el
   * tiempo (entrada, salida, entrada…). Si la siguiente llega después del tope
   * de jornada, la entrada queda sin salida y esa checada abre otra. Una
   * entrada abierta de hace menos del tope es `OPEN_ENTRY` (en sitio). No hay
   * `EXIT_WITHOUT_ENTRY`: sin tipo, una checada suelta siempre es entrada.
   */
  private emparejar(id: string, instantes: Date[], range: ReportRange): AccessReportSession[] {
    const sesiones: AccessReportSession[] = [];
    let entrada: Date | null = null;

    for (const t of instantes) {
      if (!entrada) {
        entrada = t;
      } else if (t.getTime() - entrada.getTime() <= MAX_JORNADA_MS) {
        sesiones.push(this.sesion(id, entrada, t, null, range.timezone));
        entrada = null;
      } else {
        sesiones.push(this.sesion(id, entrada, null, "ENTRY_WITHOUT_EXIT", range.timezone));
        entrada = t;
      }
    }

    if (entrada) {
      const enSitio = Date.now() - entrada.getTime() < MAX_JORNADA_MS;
      sesiones.push(
        this.sesion(id, entrada, null, enSitio ? "OPEN_ENTRY" : "ENTRY_WITHOUT_EXIT", range.timezone)
      );
    }
    return sesiones;
  }

  private sesion(
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
  private inWindow(sesion: AccessReportSession, range: ReportRange): boolean {
    const anchor = sesion.entryAt ?? sesion.exitAt;
    return anchor !== null && anchor >= range.start && anchor < range.end;
  }

  private fila(
    persona: Persona,
    sesion: AccessReportSession,
    index: number,
    range: ReportRange
  ): ChecadorReportSessionRow {
    const anchor = sesion.entryAt ?? sesion.exitAt;
    return {
      id: `${persona.id}-${anchor?.getTime() ?? 0}-${index}`,
      employeeId: persona.id,
      employeeName: persona.name,
      numeroEmpleado: persona.numeroEmpleado,
      puesto: persona.puesto,
      departmentId: persona.department?.id ?? null,
      departmentName: persona.department?.name ?? null,
      active: persona.active,
      date: anchor ? localDateKey(anchor, range.timezone) : "",
      entryAt: sesion.entryAt?.toISOString() ?? null,
      exitAt: sesion.exitAt?.toISOString() ?? null,
      workedMinutes: sesion.workedMinutes,
      incident: sesion.incident,
      crossesMidnight: sesion.crossesMidnight,
      vinculado: persona.vinculado,
    };
  }

  /** Mismas llaves de orden que el reporte de acceso. */
  private ordenar(
    rows: ChecadorReportSessionRow[],
    sort: ITDataTableFetchParams["sort"]
  ): ChecadorReportSessionRow[] {
    const sorters: Record<string, (a: ChecadorReportSessionRow, b: ChecadorReportSessionRow) => number> = {
      employeeName: (a, b) => a.employeeName.localeCompare(b.employeeName),
      numeroEmpleado: (a, b) => (a.numeroEmpleado ?? "").localeCompare(b.numeroEmpleado ?? ""),
      departmentName: (a, b) => (a.departmentName ?? "").localeCompare(b.departmentName ?? ""),
      puesto: (a, b) => (a.puesto ?? "").localeCompare(b.puesto ?? ""),
      date: (a, b) => a.date.localeCompare(b.date),
      entryAt: (a, b) => (a.entryAt ?? "").localeCompare(b.entryAt ?? ""),
      exitAt: (a, b) => (a.exitAt ?? "").localeCompare(b.exitAt ?? ""),
      workedMinutes: (a, b) => a.workedMinutes - b.workedMinutes,
    };
    const fallback = (a: ChecadorReportSessionRow, b: ChecadorReportSessionRow): number =>
      a.employeeName.localeCompare(b.employeeName) || (a.entryAt ?? "").localeCompare(b.entryAt ?? "");

    const comparator = (sort ? sorters[sort.key] : undefined) ?? fallback;
    const sorted = [...rows].sort(comparator);
    return sort?.direction === "desc" ? sorted.reverse() : sorted;
  }
}
