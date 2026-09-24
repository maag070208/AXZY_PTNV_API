import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, orderByOf, type ITDataTableFetchParams, type ITDataTableResponse } from "@core/utils/table";
import {
  assertDateKey,
  localDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
  startOfLocalDay,
  type ReportPeriod,
} from "@core/utils/timezone";
import { ChecadorReportService } from "@modules/checador/services/checador-report.service";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  HorasExtraDayRow,
  HorasExtraRow,
  HorasExtraSummary,
} from "../models/entity/horario.entity";
import type { AsignacionCreateInput, HorarioCreateInput, HorarioUpdateInput } from "../models/dto/horario.dto";

type SysConfigReader = (key: string) => Promise<string | null>;

const MS_PER_MINUTE = 60 * 1000;

/** "HH:mm" → minutos desde medianoche. */
const toMinutes = (hhmm: string | null): number => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Día de la semana 1..7 (1=Lunes) de una clave `YYYY-MM-DD`. */
const weekdayOf = (dayKey: string): number => {
  const js = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0=Dom
  return js === 0 ? 7 : js;
};

/** Día local `YYYY-MM-DD` como instante UTC-medianoche (mismo criterio que `AsignacionHorario.desde`). */
export const toUtcDate = (dayKey: string): Date => new Date(`${dayKey}T00:00:00.000Z`);

/** Clave `YYYY-MM-DD` de una fecha guardada como UTC-medianoche. */
export const dateKeyOf = (date: Date): string => date.toISOString().slice(0, 10);

const minutesBetween = (from: string | null, to: string | null): number => {
  if (!from || !to) return 0;
  const diff = toMinutes(to) - toMinutes(from);
  return diff > 0 ? diff : diff + 24 * 60; // tramo que cruza medianoche
};

export class HorarioService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly checadorReport: ChecadorReportService = new ChecadorReportService(prismaClient),
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  // ── Catálogo ────────────────────────────────────────────────────────────

  async list(includeInactive = false) {
    const rows = await this.db.horario.findMany({
      where: includeInactive ? {} : { activo: true },
      include: {
        dias: { orderBy: { diaSemana: "asc" } },
        _count: { select: { asignaciones: { where: { hasta: null } } } },
      },
      orderBy: { nombre: "asc" },
    });
    return rows.map((h) => ({ ...h, asignados: h._count.asignaciones }));
  }

  private normalizeDia(d: HorarioCreateInput["dias"][number]) {
    const descanso = d.descanso ?? false;
    return {
      diaSemana: d.diaSemana,
      descanso,
      entrada: descanso ? null : d.entrada ?? null,
      salida: descanso ? null : d.salida ?? null,
      entrada2: descanso ? null : d.entrada2 ?? null,
      salida2: descanso ? null : d.salida2 ?? null,
    };
  }

  async create(data: HorarioCreateInput) {
    const dup = await this.db.horario.findUnique({ where: { nombre: data.nombre } });
    if (dup) throw new HttpError(409, "Ya existe un horario con ese nombre");

    return this.db.horario.create({
      data: {
        nombre: data.nombre,
        toleranciaEntradaMin: data.toleranciaEntradaMin ?? 10,
        toleranciaSalidaMin: data.toleranciaSalidaMin ?? 10,
        comidaMin: data.comidaMin ?? 0,
        cruzaMedianoche: data.cruzaMedianoche ?? false,
        dias: { create: data.dias.map((d) => this.normalizeDia(d)) },
      },
      include: { dias: { orderBy: { diaSemana: "asc" } } },
    });
  }

  async update(id: string, data: HorarioUpdateInput) {
    const horario = await this.db.horario.findUnique({ where: { id } });
    if (!horario) throw new HttpError(404, "Horario no encontrado");

    if (data.nombre && data.nombre !== horario.nombre) {
      const dup = await this.db.horario.findUnique({ where: { nombre: data.nombre } });
      if (dup && dup.id !== id) throw new HttpError(409, "Ya existe un horario con ese nombre");
    }

    return this.db.$transaction(async (tx) => {
      if (data.dias) {
        await tx.horarioDia.deleteMany({ where: { horarioId: id } });
      }
      return tx.horario.update({
        where: { id },
        data: {
          nombre: data.nombre,
          toleranciaEntradaMin: data.toleranciaEntradaMin,
          toleranciaSalidaMin: data.toleranciaSalidaMin,
          comidaMin: data.comidaMin,
          cruzaMedianoche: data.cruzaMedianoche,
          activo: data.activo,
          ...(data.dias ? { dias: { create: data.dias.map((d) => this.normalizeDia(d)) } } : {}),
        },
        include: { dias: { orderBy: { diaSemana: "asc" } } },
      });
    });
  }

  async remove(id: string) {
    const horario = await this.db.horario.findUnique({ where: { id } });
    if (!horario) throw new HttpError(404, "Horario no encontrado");

    const asignados = await this.db.asignacionHorario.count({ where: { horarioId: id, hasta: null } });
    if (asignados > 0 || horario.activo) {
      const data = await this.db.horario.update({ where: { id }, data: { activo: false } });
      return { soft: true, data };
    }
    const data = await this.db.horario.delete({ where: { id } });
    return { soft: false, data };
  }

  // ── Asignación ──────────────────────────────────────────────────────────

  /** Asigna un horario a N personas desde una fecha, cerrando la vigencia previa. */
  async asignarMasivo(data: AsignacionCreateInput, actorId?: string) {
    const horario = await this.db.horario.findUnique({ where: { id: data.horarioId } });
    if (!horario || !horario.activo) throw new HttpError(400, "Horario inválido o inactivo");

    const userIds = [...new Set(data.userIds)];
    const users = await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    const valid = users.map((u) => u.id);
    if (valid.length === 0) throw new HttpError(400, "No hay personas válidas para asignar");

    const desde = toUtcDate(data.desde);
    const dayBefore = new Date(desde.getTime() - 24 * 60 * MS_PER_MINUTE);

    const asignados = await this.db.$transaction(async (tx) => {
      // Cierra las asignaciones que cubren la fecha `desde`.
      await tx.asignacionHorario.updateMany({
        where: {
          userId: { in: valid },
          desde: { lte: desde },
          OR: [{ hasta: null }, { hasta: { gte: desde } }],
        },
        data: { hasta: dayBefore },
      });
      const created = await tx.asignacionHorario.createMany({
        data: valid.map((userId) => ({
          userId,
          horarioId: data.horarioId,
          desde,
          creadoPorId: actorId ?? null,
        })),
      });
      return created.count;
    });

    await this.audit?.({
      action: "HORARIO_ASIGNACION",
      entityType: "Horario",
      entityId: horario.id,
      userId: actorId,
      metadata: { asignados, horario: horario.nombre, desde: data.desde },
    });

    return { asignados, horario: horario.nombre, desde: data.desde };
  }

  /** Personas con asignación vigente (hasta = null) de un horario. */
  async asignadosDeHorario(horarioId: string) {
    const rows = await this.db.asignacionHorario.findMany({
      where: { horarioId, hasta: null },
      include: { user: { select: { id: true, name: true, numeroEmpleado: true } } },
      orderBy: { user: { name: "asc" } },
    });
    return rows.map((a) => ({
      userId: a.userId,
      employeeName: a.user?.name ?? "—",
      numeroEmpleado: a.user?.numeroEmpleado ?? null,
    }));
  }

  /** Quita (cierra la vigencia) la asignación de varias personas a un horario. */
  async quitarMasivo(data: { horarioId: string; userIds: string[] }, actorId?: string) {
    const userIds = [...new Set(data.userIds)];
    if (userIds.length === 0) return { quitados: 0 };

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hasta = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));

    const res = await this.db.asignacionHorario.updateMany({
      where: { horarioId: data.horarioId, userId: { in: userIds }, hasta: null },
      data: { hasta },
    });

    await this.audit?.({
      action: "HORARIO_ASIGNACION_QUITAR",
      entityType: "Horario",
      entityId: data.horarioId,
      userId: actorId,
      metadata: { quitados: res.count },
    });

    return { quitados: res.count };
  }

  async asignacionesTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<unknown>> {    const { filters } = params;
    const where: Record<string, unknown> = { hasta: null };
    if (filters.horarioId) where.horarioId = String(filters.horarioId);
    if (filters.departmentId) where.user = { departmentId: String(filters.departmentId) };
    if (typeof filters.q === "string" && filters.q.trim() !== "") {
      where.user = { ...(where.user as object), OR: [{ name: ci(filters.q) }, { numeroEmpleado: ci(filters.q) }] };
    }

    const orderBy = orderByOf(params.sort, { desde: "desde" }, [{ desde: "desc" }]);

    const [total, data] = await this.db.$transaction([
      this.db.asignacionHorario.count({ where: where as never }),
      this.db.asignacionHorario.findMany({
        where: where as never,
        include: {
          user: { select: { id: true, name: true, numeroEmpleado: true, department: { select: { id: true, name: true } } } },
          horario: { select: { id: true, nombre: true } },
        },
        orderBy: orderBy as never,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    ]);

    const rows = data.map((a) => ({
      id: a.id,
      userId: a.userId,
      employeeName: a.user?.name ?? "—",
      numeroEmpleado: a.user?.numeroEmpleado ?? null,
      departmentId: a.user?.department?.id ?? null,
      departmentName: a.user?.department?.name ?? null,
      horarioId: a.horarioId,
      horarioNombre: a.horario?.nombre ?? "—",
      desde: a.desde,
    }));

    return { data: rows, total };
  }

  // ── Horas extra ─────────────────────────────────────────────────────────

  private async resolveRange(filters: Record<string, string | number | boolean>) {
    const rawPeriod = filters.period;
    if (rawPeriod !== "DAY" && rawPeriod !== "WEEK" && rawPeriod !== "MONTH") {
      throw new HttpError(400, { code: "INVALID_REPORT_PERIOD", message: "period debe ser DAY, WEEK o MONTH" });
    }
    const dateKey = assertDateKey(filters.date, "INVALID_REPORT_DATE");
    const explicitTz = typeof filters.tz === "string" && filters.tz !== "" ? filters.tz : undefined;
    const timezone = await resolveTimezoneWithConfig(explicitTz, this.sysConfig);
    const { start, end } = resolveReportRange(rawPeriod, dateKey, timezone);
    return { start, end, timezone, period: rawPeriod as ReportPeriod };
  }

  /** Campos permitidos para ordenar el reporte (evita keys arbitrarias del cliente). */
  private static readonly SORTABLE_FIELDS = new Set([
    "employeeName",
    "departmentName",
    "horarioNombre",
    "extraMin",
    "trabajadasMin",
    "programadasMin",
    "diasConExtra",
    "aprobadoMin",
    "pendienteMin",
    "rechazadoMin",
    "diasAprobados",
    "diasPendientes",
    "diasRechazados",
  ]);

  /**
   * Ordena en memoria las filas del reporte según `sort` del ITDataTable.
   * Key fuera del allowlist o sin `sort` → devuelve el orden por defecto
   * (`extraMin desc`) que ya trae `computeHorasExtra`.
   */
  private applySort(rows: HorasExtraRow[], sort: ITDataTableFetchParams["sort"]): HorasExtraRow[] {
    if (!sort || !HorarioService.SORTABLE_FIELDS.has(sort.key)) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    const key = sort.key as keyof HorasExtraRow;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }

  /**
   * Horas extra = tiempo trabajado DESPUÉS de la salida programada (+tolerancia).
   * Entrar antes de la hora no genera extra.
   */
  async horasExtra(params: ITDataTableFetchParams): Promise<{
    data: HorasExtraRow[];
    total: number;
    summary: HorasExtraSummary;
  }> {
    const { sorted, summary } = await this.computeHorasExtra(params);
    const ordered = this.applySort(sorted, params.sort);
    const from = (params.page - 1) * params.limit;
    return { data: ordered.slice(from, from + params.limit), total: ordered.length, summary };
  }

  async horasExtraExport(params: ITDataTableFetchParams): Promise<{
    data: HorasExtraRow[];
    total: number;
    summary: HorasExtraSummary;
  }> {
    const { sorted, summary } = await this.computeHorasExtra(params);
    return { data: sorted, total: sorted.length, summary };
  }

  /**
   * Cálculo diario del tiempo extra: una fila por (persona, día) del periodo.
   * Fuente = checadas del reloj (`ChecadorReportService`), NO la bitácora del
   * guardia. Solo se consideran las personas vinculadas a un usuario; las filas
   * `reloj:<número>` no tienen horario asignado ni se pueden aprobar.
   *
   * Es público porque el módulo de aprobación de tiempo extra lo reutiliza para
   * materializar al vuelo los pendientes.
   */
  async computeOvertimeDays(params: ITDataTableFetchParams): Promise<{
    days: HorasExtraDayRow[];
    range: { start: Date; end: Date; timezone: string; period: ReportPeriod };
  }> {
    const range = await this.resolveRange(params.filters);

    // Sesiones del periodo desde el reloj (una fila por sesión).
    const sessionsRes = await this.checadorReport.reportExport({
      page: 1,
      limit: 100000,
      filters: params.filters,
      sort: undefined,
    });
    const sessions = sessionsRes.data.filter((s) => s.vinculado === true);

    const byPerson = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const list = byPerson.get(s.employeeId);
      if (list) list.push(s);
      else byPerson.set(s.employeeId, [s]);
    }

    const userIds = [...byPerson.keys()];
    const assignments = userIds.length
      ? await this.db.asignacionHorario.findMany({
          where: {
            userId: { in: userIds },
            desde: { lt: range.end },
            OR: [{ hasta: null }, { hasta: { gte: range.start } }],
          },
          include: { horario: { include: { dias: true } } },
          orderBy: { desde: "asc" },
        })
      : [];

    const days: HorasExtraDayRow[] = [];

    for (const [userId, personSessions] of byPerson) {
      const first = personSessions[0];
      const personAssignments = assignments.filter((a) => a.userId === userId);

      // Sesiones agrupadas por día local.
      const byDay = new Map<string, typeof personSessions>();
      for (const s of personSessions) {
        const list = byDay.get(s.date);
        if (list) list.push(s);
        else byDay.set(s.date, [s]);
      }

      for (const [dayKey, daySessions] of byDay) {
        const worked = daySessions.reduce((acc, s) => acc + s.workedMinutes, 0);

        const dayStartMs = toUtcDate(dayKey).getTime();
        const asg = personAssignments.find(
          (a) => a.desde.getTime() <= dayStartMs && (!a.hasta || a.hasta.getTime() >= dayStartMs)
        );

        let extraMin = 0;
        let programadasMin = 0;
        let descanso = false;
        let horarioNombre: string | null = null;

        if (asg) {
          horarioNombre = asg.horario.nombre;
          const dia = asg.horario.dias.find((d) => d.diaSemana === weekdayOf(dayKey));
          if (!dia || dia.descanso) {
            // Día de descanso: todo lo trabajado cuenta como extra.
            descanso = true;
            if (worked > 0) extraMin += worked;
          } else {
            const sched =
              minutesBetween(dia.entrada, dia.salida) +
              (dia.entrada2 && dia.salida2 ? minutesBetween(dia.entrada2, dia.salida2) : 0) -
              asg.horario.comidaMin;
            programadasMin = Math.max(0, sched);

            // Salida programada (último tramo) como instante local.
            const lastSalida = dia.salida2 ?? dia.salida;
            if (lastSalida) {
              const crosses = asg.horario.cruzaMedianoche || toMinutes(lastSalida) <= toMinutes(dia.entrada);
              const exitMs =
                startOfLocalDay(dayKey, range.timezone).getTime() +
                (toMinutes(lastSalida) + (crosses ? 24 * 60 : 0)) * MS_PER_MINUTE;

              const lastExit = daySessions
                .map((s) => (s.exitAt ? new Date(s.exitAt).getTime() : 0))
                .reduce((a, b) => Math.max(a, b), 0);
              if (lastExit > 0) {
                const afterExit = Math.round((lastExit - exitMs) / MS_PER_MINUTE);
                const dayExtra = Math.max(0, afterExit - asg.horario.toleranciaSalidaMin);
                if (dayExtra > 0) extraMin += dayExtra;
              }
            }
          }
        }

        days.push({
          userId,
          employeeName: first.employeeName,
          numeroEmpleado: first.numeroEmpleado,
          departmentId: first.departmentId,
          departmentName: first.departmentName,
          active: first.active,
          date: dayKey,
          extraMin,
          workedMin: worked,
          programadasMin,
          horarioNombre,
          descanso,
          sinHorario: !asg,
        });
      }
    }

    return { days, range };
  }

  /**
   * Agrega el cálculo diario por persona y recontabiliza con las decisiones
   * guardadas en `overtime_approvals`:
   * - `aprobadoMin`/`rechazadoMin` = suma de snapshots APROBADO/RECHAZADO.
   * - `pendienteMin` = suma del `extraMin` calculado de los días SIN fila.
   * `extraMin` sigue siendo el CALCULADO (no cambia de significado).
   */
  private async computeHorasExtra(params: ITDataTableFetchParams): Promise<{
    sorted: HorasExtraRow[];
    summary: HorasExtraSummary;
  }> {
    const { days, range } = await this.computeOvertimeDays(params);

    const byPerson = new Map<string, HorasExtraDayRow[]>();
    for (const d of days) {
      const list = byPerson.get(d.userId);
      if (list) list.push(d);
      else byPerson.set(d.userId, [d]);
    }

    const userIds = [...byPerson.keys()];
    // Rango de días locales del periodo para leer las decisiones guardadas.
    const firstDay = toUtcDate(localDateKey(range.start, range.timezone));
    const lastDay = toUtcDate(localDateKey(new Date(range.end.getTime() - 1), range.timezone));
    const approvals = userIds.length
      ? await this.db.overtimeApproval.findMany({
          where: { userId: { in: userIds }, date: { gte: firstDay, lte: lastDay } },
        })
      : [];
    const approvalByKey = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) approvalByKey.set(`${a.userId}|${dateKeyOf(a.date)}`, a);

    const rows: HorasExtraRow[] = [];

    for (const [userId, personDays] of byPerson) {
      const first = personDays[0];

      let trabajadasMin = 0;
      let programadasMin = 0;
      let extraMin = 0;
      let diasConExtra = 0;
      let horarioNombre: string | null = null;
      let sinHorario = true;
      let aprobadoMin = 0;
      let rechazadoMin = 0;
      let pendienteMin = 0;
      let diasAprobados = 0;
      let diasRechazados = 0;
      let diasPendientes = 0;

      for (const d of personDays) {
        trabajadasMin += d.workedMin;
        programadasMin += d.programadasMin;
        extraMin += d.extraMin;
        if (d.extraMin > 0) diasConExtra += 1;
        if (d.horarioNombre) {
          horarioNombre = d.horarioNombre;
          sinHorario = false;
        }

        const ap = approvalByKey.get(`${userId}|${d.date}`);
        if (ap?.status === "APROBADO") {
          aprobadoMin += ap.extraMin;
          diasAprobados += 1;
        } else if (ap?.status === "RECHAZADO") {
          rechazadoMin += ap.extraMin;
          diasRechazados += 1;
        } else if (d.extraMin > 0) {
          pendienteMin += d.extraMin;
          diasPendientes += 1;
        }
      }

      rows.push({
        userId,
        employeeName: first.employeeName,
        numeroEmpleado: first.numeroEmpleado,
        departmentId: first.departmentId,
        departmentName: first.departmentName,
        active: first.active,
        horarioNombre,
        programadasMin,
        trabajadasMin,
        extraMin,
        faltanteMin: Math.max(0, programadasMin - trabajadasMin),
        diasConExtra,
        sinHorario,
        aprobadoMin,
        pendienteMin,
        rechazadoMin,
        diasAprobados,
        diasPendientes,
        diasRechazados,
      });
    }

    const sorted = [...rows].sort((a, b) => b.extraMin - a.extraMin || a.employeeName.localeCompare(b.employeeName));

    const summary: HorasExtraSummary = {
      peopleTotal: sorted.length,
      peopleWithExtra: sorted.filter((r) => r.extraMin > 0).length,
      totalExtraMinutes: sorted.reduce((acc, r) => acc + r.extraMin, 0),
      totalWorkedMinutes: sorted.reduce((acc, r) => acc + r.trabajadasMin, 0),
      totalScheduledMinutes: sorted.reduce((acc, r) => acc + r.programadasMin, 0),
      totalApprovedMinutes: sorted.reduce((acc, r) => acc + r.aprobadoMin, 0),
      totalPendingMinutes: sorted.reduce((acc, r) => acc + r.pendienteMin, 0),
      totalRejectedMinutes: sorted.reduce((acc, r) => acc + r.rechazadoMin, 0),
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone: range.timezone, period: range.period },
    };

    return { sorted, summary };
  }
}
