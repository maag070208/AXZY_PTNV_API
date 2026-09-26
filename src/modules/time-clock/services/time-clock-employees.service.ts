import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, type ITDataTableFetchParams } from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  TimeClockEmployeeRow,
  TimeClockEmployeesSummary,
  TimeClockUserRef,
} from "../models/entity/time-clock.entity";

// ── Sugerencias de vínculo ───────────────────────────────────────────────────
//
// El número del reloj NO es el `numeroEmpleado` del sistema: el reloj antepone
// el área (070562 ↔ 562) y el número de nómina se repite entre áreas (040001 y
// 110001). Por eso el vínculo es explícito y aquí solo se SUGIERE: el nombre
// tiene que coincidir siempre (en cualquier orden) y el número solo sube la
// confianza. Ver CHECADOR.md §5.

/** Partículas que no distinguen a nadie ("MARIA DE LOS ANGELES"). */
const PARTICLES = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

/** Palabras del nombre en mayúsculas, sin acentos ni partículas. */
const words = (name: string): string[] =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p.length > 1 && !PARTICLES.has(p));

/**
 * Mismo nombre aunque cambie el orden. Los hermanos comparten los dos
 * apellidos, así que con nombres de 3+ palabras se piden 3 en común.
 */
const nameMatches = (a: string[], b: string[]): boolean => {
  const inB = new Set(b);
  const common = new Set(a.filter((p) => inB.has(p))).size;
  return common >= 2 && common >= Math.min(3, a.length, b.length);
};

/** Número de nómina de un número del reloj: sin el prefijo de área (070562 → 562). */
const clockPayroll = (number: string): number | null => {
  if (/^\d{6}$/.test(number)) return Number(number.slice(2));
  return /^\d+$/.test(number) ? Number(number) : null;
};

const numberMatches = (clockNumber: string, userNumber: string | null): boolean => {
  const payroll = clockPayroll(clockNumber);
  return (
    payroll !== null && userNumber !== null && /^\d+$/.test(userNumber) && Number(userNumber) === payroll
  );
};

type Candidate = TimeClockUserRef & { words: string[] };

const suggest = (
  number: string,
  name: string,
  candidates: Candidate[]
): TimeClockEmployeeRow["suggestion"] => {
  const fromClock = words(name);
  const byName = candidates.filter((c) => nameMatches(fromClock, c.words));
  const byNumber = byName.filter((c) => numberMatches(number, c.employeeNumber));
  const [selected, confidence] =
    byNumber.length === 1
      ? [byNumber[0], "HIGH" as const]
      : byName.length === 1
        ? [byName[0], "MEDIUM" as const]
        : [null, null];
  if (!selected || !confidence) return null;
  const { words: _words, ...user } = selected;
  return { ...user, confidence };
};

const userSelect = { id: true, name: true, employeeNumber: true, active: true } as const;

const toRef = (u: { id: string; name: string; employeeNumber: string | null; active: boolean }): TimeClockUserRef => ({
  userId: u.id,
  name: u.name,
  employeeNumber: u.employeeNumber,
  active: u.active,
});

/**
 * Empleados del reloj (vistos en sus checadas) y su vínculo con los usuarios
 * del sistema: tabla con sugerencias, vincular, desvincular y vincular de un
 * jalón las sugerencias `ALTA`.
 */
export class TimeClockEmployeesService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Tabla de empleados del reloj; se resuelve en memoria (unos cientos de filas). */
  async table(params: ITDataTableFetchParams) {
    const rows = await this.rows();
    const { filters } = params;

    const q = ci(filters.q)?.contains.toLowerCase();
    const status = typeof filters.status === "string" ? filters.status : undefined;
    const filtered = rows.filter((f) => {
      if (status === "LINKED" && !f.link) return false;
      if (status === "UNLINKED" && f.link) return false;
      if (status === "SUGGESTED" && (f.link || !f.suggestion)) return false;
      if (q) {
        const text = [f.employeeNumber, f.name, f.link?.name, f.link?.employeeNumber]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const sorters: Record<string, (a: TimeClockEmployeeRow, b: TimeClockEmployeeRow) => number> = {
      employeeNumber: (a, b) => a.employeeNumber.localeCompare(b.employeeNumber),
      name: (a, b) => a.name.localeCompare(b.name),
      punches: (a, b) => a.punches - b.punches,
      lastPunch: (a, b) => a.lastPunch.getTime() - b.lastPunch.getTime(),
    };
    const sorter = (params.sort && sorters[params.sort.key]) ?? sorters.name;
    const sorted = [...filtered].sort(sorter);
    if (params.sort?.direction === "desc") sorted.reverse();

    const from = (params.page - 1) * params.limit;
    return {
      data: sorted.slice(from, from + params.limit),
      total: sorted.length,
      summary: this.summary(rows),
    };
  }

  /** Vincula (o cambia el vínculo de) un número del reloj con un usuario. */
  async linkEmployee(employeeNumber: string, userId: string, actorId?: string): Promise<TimeClockEmployeeRow> {
    const inClock = await this.db.timeClockPunch.findFirst({ where: { employeeNumber }, select: { id: true } });
    if (!inClock) {
      throw new HttpError(404, {
        code: "TIME_CLOCK_EMPLOYEE_NOT_FOUND",
        message: `El número ${employeeNumber} no tiene checadas en el reloj`,
      });
    }
    const user = await this.db.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw new HttpError(404, { code: "USER_NOT_FOUND", message: "Usuario no encontrado" });

    await this.db.timeClockEmployee.upsert({
      where: { employeeNumber },
      create: { employeeNumber, userId, linkedById: actorId ?? null },
      update: { userId, linkedById: actorId ?? null },
    });
    await this.audit?.({
      action: "TIME_CLOCK_LINKED",
      entityType: "TimeClockEmployee",
      entityId: employeeNumber,
      userId: actorId,
      metadata: { employeeNumber, user: user.name, userId: user.id },
    });

    const row = (await this.rows()).find((f) => f.employeeNumber === employeeNumber);
    return row!;
  }

  async unlinkEmployee(employeeNumber: string, actorId?: string): Promise<{ employeeNumber: string }> {
    const link = await this.db.timeClockEmployee.findUnique({ where: { employeeNumber } });
    if (!link) {
      throw new HttpError(404, {
        code: "TIME_CLOCK_LINK_NOT_FOUND",
        message: `El número ${employeeNumber} no está vinculado`,
      });
    }
    await this.db.timeClockEmployee.delete({ where: { employeeNumber } });
    await this.audit?.({
      action: "TIME_CLOCK_UNLINKED",
      entityType: "TimeClockEmployee",
      entityId: employeeNumber,
      userId: actorId,
      metadata: { employeeNumber, userId: link.userId },
    });
    return { employeeNumber };
  }

  /** Vincula de un jalón las sugerencias `ALTA` (nombre y número coinciden). */
  async linkSuggested(actorId?: string): Promise<{ linkedCount: number }> {
    const suggested = (await this.rows()).filter(
      (f) => !f.link && f.suggestion?.confidence === "HIGH"
    );
    if (suggested.length === 0) return { linkedCount: 0 };

    const { count } = await this.db.timeClockEmployee.createMany({
      data: suggested.map((f) => ({
        employeeNumber: f.employeeNumber,
        userId: f.suggestion!.userId,
        linkedById: actorId ?? null,
      })),
      skipDuplicates: true,
    });
    for (const f of suggested) {
      await this.audit?.({
        action: "TIME_CLOCK_LINKED",
        entityType: "TimeClockEmployee",
        entityId: f.employeeNumber,
        userId: actorId,
        metadata: {
          employeeNumber: f.employeeNumber,
          user: f.suggestion!.name,
          userId: f.suggestion!.userId,
          suggestion: "HIGH",
        },
      });
    }
    return { linkedCount: count };
  }

  // ── Cálculo ────────────────────────────────────────────────────────────────

  /** Todos los empleados del reloj con su vínculo o su sugerencia. */
  private async rows(): Promise<TimeClockEmployeeRow[]> {
    const [fromClock, links, free] = await Promise.all([
      this.db.$queryRaw<{ employeeNumber: string; name: string; punches: number; lastPunch: Date }[]>`
        SELECT "employeeNumber",
               (array_agg("name" ORDER BY "occurredAt" DESC))[1] AS "name",
               count(*)::int AS "punches",
               max("occurredAt") AS "lastPunch"
        FROM "time_clock_punches"
        GROUP BY "employeeNumber"`,
      this.db.timeClockEmployee.findMany({ select: { employeeNumber: true, user: { select: userSelect } } }),
      // Se sugieren usuarios que aún no tienen número del reloj, también los
      // dados de baja: el vínculo es de identidad, y una baja que sigue
      // checando es justo algo que RH tiene que ver.
      this.db.user.findMany({
        where: { timeClockEmployees: { none: {} } },
        select: userSelect,
      }),
    ]);

    const byNumber = new Map(links.map((v) => [v.employeeNumber, toRef(v.user)]));
    const candidates: Candidate[] = free.map((u) => ({ ...toRef(u), words: words(u.name) }));

    return fromClock.map((r) => {
      const link = byNumber.get(r.employeeNumber) ?? null;
      return {
        employeeNumber: r.employeeNumber,
        name: r.name,
        punches: r.punches,
        lastPunch: r.lastPunch,
        link,
        suggestion: link ? null : suggest(r.employeeNumber, r.name, candidates),
      };
    });
  }

  private summary(rows: TimeClockEmployeeRow[]): TimeClockEmployeesSummary {
    const linkedCount = rows.filter((f) => f.link).length;
    return {
      total: rows.length,
      linkedCount,
      withoutLink: rows.length - linkedCount,
      registrationSuggestions: rows.filter((f) => !f.link && f.suggestion?.confidence === "HIGH").length,
    };
  }
}
