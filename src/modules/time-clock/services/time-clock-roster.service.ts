import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { logger } from "@core/utils/logger";
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiClient } from "./isapi.client";
import { planRoster, type RosterLink, type RosterReading } from "./roster-plan";
import type { TimeClockCredentials } from "./time-clock.service";

/** Da de baja al usuario con el flujo de siempre (`UserService.deactivate`). */
export type UserDeactivator = (
  userId: string,
  actorId: string,
  input: { reason: string; notifyUser: boolean; categoryId?: string }
) => Promise<unknown>;

/** Avisos a RH (campanita y correo) cuando hay bajas pendientes, reapariciones o una corrida sospechosa. */
export interface RosterAlerts {
  notifyRosterAlert(input: { pending: number; reappeared: number; suspicious: boolean }): Promise<unknown>;
}

const CATEGORY_NOT_FOUND = "REMOVAL_CATEGORY_NOT_FOUND";

interface ClockRead {
  serial: string;
  name: string | null;
  reading: RosterReading;
  names: Map<string, string>;
  summary: { serial: string; ok: boolean; count: number; error: string | null };
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Padrón de empleados desde los relojes que cuentan para asistencia
 * (TIME_CLOCK_SYNC.md). Lee la lista de personas de cada reloj (solo lectura),
 * aplica las reglas de `roster-plan.ts` y guarda el resultado. Nunca escribe al
 * reloj ni crea usuarios; las bajas solo pasan con motivo capturado por RH.
 */
export class TimeClockRosterService {
  private running = false;

  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly credentials: TimeClockCredentials | null = null,
    private readonly audit?: AuditLogger,
    private readonly deactivateUser?: UserDeactivator,
    private readonly alerts?: RosterAlerts
  ) {}

  /** Corrida completa del padrón. Un solo corrido a la vez (409 si ya hay una). */
  async run(trigger: "AUTO" | "MANUAL") {
    if (!this.credentials) throw new HttpError(503, "TIME_CLOCK_NOT_CONFIGURED");
    if (this.running) throw new HttpError(409, "TIME_CLOCK_ROSTER_IN_PROGRESS");
    this.running = true;
    const startedAt = new Date();
    try {
      const clocks = await this.db.timeClock.findMany({
        where: { countsAttendance: true, url: { not: null } },
        select: { serialNumber: true, url: true, name: true },
      });

      const reads: ClockRead[] = [];
      for (const clock of clocks) {
        reads.push(await this.readClock(clock.serialNumber, clock.name, clock.url!));
      }

      const links = await this.db.timeClockEmployee.findMany({
        select: {
          employeeNumber: true,
          status: true,
          missingRuns: true,
          missingSince: true,
          reappearedAt: true,
          user: { select: { active: true } },
        },
      });
      const linkState: RosterLink[] = links.map((l) => ({
        employeeNumber: l.employeeNumber,
        userActive: l.user.active,
        status: l.status,
        missingRuns: l.missingRuns,
        missingSince: l.missingSince,
        reappearedAt: l.reappearedAt,
      }));

      const plan = planRoster({
        now: startedAt,
        readings: reads.map((r) => r.reading),
        links: linkState,
      });

      const names = new Map<string, string>();
      reads.forEach((r) => r.names.forEach((name, number) => names.has(number) || names.set(number, name)));

      await this.db.$transaction(async (tx) => {
        for (const serial of plan.replaceClocks) {
          const read = reads.find((r) => r.serial === serial)!;
          await tx.timeClockRosterEntry.deleteMany({ where: { clockSerial: serial } });
          if (read.names.size > 0) {
            await tx.timeClockRosterEntry.createMany({
              data: [...read.names].map(([employeeNumber, name]) => ({
                clockSerial: serial,
                employeeNumber,
                name,
                lastSeenAt: startedAt,
              })),
            });
          }
        }
        for (const change of plan.changes) {
          const { employeeNumber, event: _event, ...data } = change;
          await tx.timeClockEmployee.update({ where: { employeeNumber }, data });
        }
        await tx.timeClockRosterRun.create({
          data: {
            trigger,
            startedAt,
            finishedAt: new Date(),
            ok: !plan.noRun,
            suspicious: plan.suspicious,
            added: plan.added,
            removalPending: plan.changes.filter((c) => c.event === "REMOVAL_PENDING").length,
            cancelled: plan.changes.filter((c) => c.event === "REMOVAL_CANCELLED").length,
            reappeared: plan.changes.filter((c) => c.event === "REAPPEARED").length,
            perClock: reads.map((r) => r.summary),
          },
        });
      });

      const pending = plan.changes.filter((c) => c.event === "REMOVAL_PENDING").length;
      const reappeared = plan.changes.filter((c) => c.event === "REAPPEARED").length;
      if (pending > 0 || reappeared > 0 || plan.suspicious) {
        // Aviso a RH; si falla no debe tumbar la corrida.
        await this.alerts
          ?.notifyRosterAlert({ pending, reappeared, suspicious: plan.suspicious })
          .catch((err: unknown) => logger.error(`[time-clock-roster] aviso a RH: ${messageOf(err)}`));
      }

      for (const change of plan.changes) {
        if (!change.event) continue;
        await this.audit?.({
          action: `TIME_CLOCK_EMPLOYEE_${change.event}`,
          entityType: "TimeClockEmployee",
          entityId: change.employeeNumber,
          userId: undefined,
          metadata: { trigger, employeeNumber: change.employeeNumber },
        });
      }
      if (plan.suspicious) {
        await this.audit?.({
          action: "TIME_CLOCK_ROSTER_SUSPICIOUS_RUN",
          entityType: "TimeClockRosterRun",
          entityId: startedAt.toISOString(),
          userId: undefined,
          metadata: { trigger, perClock: reads.map((r) => r.summary) },
        });
      }

      return {
        ok: !plan.noRun,
        suspicious: plan.suspicious,
        added: plan.added,
        removalPending: plan.changes.filter((c) => c.event === "REMOVAL_PENDING").length,
        cancelled: plan.changes.filter((c) => c.event === "REMOVAL_CANCELLED").length,
        reappeared: plan.changes.filter((c) => c.event === "REAPPEARED").length,
        newCount: plan.newNumbers.length,
        perClock: reads.map((r) => r.summary),
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Lectura de un reloj: identidad + lista completa de personas. Si algo falla o
   * la lista llega incompleta, el reloj queda como no válido (R4).
   */
  private async readClock(serial: string, name: string | null, url: string): Promise<ClockRead> {
    const previous = await this.db.timeClockRosterEntry.findMany({
      where: { clockSerial: serial },
      select: { employeeNumber: true },
    });
    const previousNumbers = previous.map((p) => p.employeeNumber);
    const fail = (error: string): ClockRead => ({
      serial,
      name,
      reading: { clockSerial: serial, ok: false, numbers: [], previousNumbers },
      names: new Map(),
      summary: { serial, ok: false, count: 0, error },
    });
    try {
      const { user, pass } = this.credentials!;
      const client = new IsapiClient(url, user, pass);
      const info = await client.deviceInfo();
      if (info.serialNumber !== serial) return fail("TIME_CLOCK_SERIAL_CHANGED");

      const names = new Map<string, string>();
      let total: number | null = null;
      for await (const page of client.users()) {
        total = page.totalMatches;
        for (const p of page.people) if (!names.has(p.employeeNumber)) names.set(p.employeeNumber, p.name);
      }
      if (total !== null && names.size < total) {
        return fail(`lectura incompleta: ${names.size} de ${total} personas`);
      }
      const numbers = [...names.keys()];
      return {
        serial,
        name,
        reading: { clockSerial: serial, ok: true, numbers, previousNumbers },
        names,
        summary: { serial, ok: true, count: numbers.length, error: null },
      };
    } catch (err) {
      logger.warn(`[time-clock-roster] ${name ?? serial}: ${messageOf(err)}`);
      return fail(messageOf(err));
    }
  }

  /** Personas del padrón: nuevas en el reloj, bajas pendientes y reapariciones. */
  async list() {
    const entries = await this.db.timeClockRosterEntry.findMany({
      where: { clock: { countsAttendance: true, url: { not: null } } },
      select: { employeeNumber: true, name: true, clock: { select: { name: true, serialNumber: true } } },
      orderBy: { employeeNumber: "asc" },
    });
    const byNumber = new Map<string, { employeeNumber: string; name: string; clocks: string[] }>();
    for (const e of entries) {
      const row = byNumber.get(e.employeeNumber) ?? { employeeNumber: e.employeeNumber, name: e.name, clocks: [] };
      row.clocks.push(e.clock.name ?? e.clock.serialNumber);
      byNumber.set(e.employeeNumber, row);
    }

    const links = await this.db.timeClockEmployee.findMany({
      select: {
        employeeNumber: true,
        status: true,
        missingSince: true,
        reappearedAt: true,
        user: { select: { id: true, name: true, active: true } },
      },
    });
    const linked = new Set(links.map((l) => l.employeeNumber));

    const lastRun = await this.db.timeClockRosterRun.findFirst({ orderBy: { startedAt: "desc" } });

    return {
      lastRun,
      unlinked: [...byNumber.values()].filter((r) => !linked.has(r.employeeNumber)),
      pendingRemovals: links
        .filter((l) => l.status === "PENDING_REMOVAL" && l.user.active)
        .map((l) => ({
          employeeNumber: l.employeeNumber,
          userId: l.user.id,
          userName: l.user.name,
          missingSince: l.missingSince,
        })),
      reappeared: links
        .filter((l) => !l.user.active && l.reappearedAt)
        .map((l) => ({
          employeeNumber: l.employeeNumber,
          userId: l.user.id,
          userName: l.user.name,
          reappearedAt: l.reappearedAt,
        })),
    };
  }

  /** Aplica la baja pendiente con motivo (R12–R13). Solo quien puede dar de baja usuarios. */
  async applyRemoval(
    employeeNumber: string,
    actorId: string,
    input: { categoryId: string; reason: string; notifyUser: boolean }
  ) {
    const link = await this.db.timeClockEmployee.findUnique({
      where: { employeeNumber },
      select: { userId: true, status: true },
    });
    if (!link) throw new HttpError(404, "TIME_CLOCK_LINK_NOT_FOUND", { employeeNumber });
    if (link.status !== "PENDING_REMOVAL") {
      throw new HttpError(409, "TIME_CLOCK_REMOVAL_NOT_PENDING", { employeeNumber });
    }
    if (!this.deactivateUser) throw new HttpError(503, "TIME_CLOCK_NOT_CONFIGURED");
    const category = await this.db.removalCategory.findFirst({
      where: { id: input.categoryId, active: true },
      select: { id: true },
    });
    if (!category) throw new HttpError(400, CATEGORY_NOT_FOUND);

    await this.deactivateUser(link.userId, actorId, input);
    await this.db.timeClockEmployee.update({
      where: { employeeNumber },
      data: { status: "ACTIVE", missingRuns: 0, missingSince: null },
    });
    await this.audit?.({
      action: "TIME_CLOCK_EMPLOYEE_REMOVAL_APPLIED",
      entityType: "TimeClockEmployee",
      entityId: employeeNumber,
      userId: actorId,
      metadata: { employeeNumber, categoryId: input.categoryId },
    });
    return { employeeNumber };
  }

  /** Catálogo de motivos de baja. */
  async listCategories(includeInactive = false) {
    return this.db.removalCategory.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true, active: true },
    });
  }

  async createCategory(input: { key: string; name: string }, actorId: string) {
    const taken = await this.db.removalCategory.findUnique({ where: { key: input.key }, select: { id: true } });
    if (taken) throw new HttpError(409, "REMOVAL_CATEGORY_KEY_TAKEN", { key: input.key });
    const created = await this.db.removalCategory.create({
      data: { key: input.key, name: input.name },
      select: { id: true, key: true, name: true, active: true },
    });
    await this.audit?.({
      action: "REMOVAL_CATEGORY_CREATED",
      entityType: "RemovalCategory",
      entityId: created.id,
      userId: actorId,
      metadata: { key: created.key, name: created.name },
    });
    return created;
  }

  async updateCategory(id: string, input: { name?: string; active?: boolean }, actorId: string) {
    const current = await this.db.removalCategory.findUnique({
      where: { id },
      select: { name: true, active: true },
    });
    if (!current) throw new HttpError(404, CATEGORY_NOT_FOUND);
    const updated = await this.db.removalCategory.update({
      where: { id },
      data: input,
      select: { id: true, key: true, name: true, active: true },
    });
    await this.audit?.({
      action: "REMOVAL_CATEGORY_UPDATED",
      entityType: "RemovalCategory",
      entityId: id,
      userId: actorId,
      metadata: { before: current, after: input },
    });
    return updated;
  }

  /** Descarta la baja pendiente sin motivo (R15). */
  async dismissRemoval(employeeNumber: string, actorId: string) {
    const link = await this.db.timeClockEmployee.findUnique({
      where: { employeeNumber },
      select: { status: true },
    });
    if (!link) throw new HttpError(404, "TIME_CLOCK_LINK_NOT_FOUND", { employeeNumber });
    if (link.status !== "PENDING_REMOVAL") {
      throw new HttpError(409, "TIME_CLOCK_REMOVAL_NOT_PENDING", { employeeNumber });
    }
    await this.db.timeClockEmployee.update({
      where: { employeeNumber },
      data: { status: "ACTIVE", missingRuns: 0, missingSince: null },
    });
    await this.audit?.({
      action: "TIME_CLOCK_EMPLOYEE_REMOVAL_CANCELLED",
      entityType: "TimeClockEmployee",
      entityId: employeeNumber,
      userId: actorId,
      metadata: { employeeNumber, manual: true },
    });
    return { employeeNumber };
  }

  /** Worker: revisa el padrón cada `intervalMs` (y al arrancar), sin tocar el cursor de checadas. */
  startWorker(intervalMs: number): () => void {
    if (!this.credentials) return () => undefined;
    const tick = (): void => {
      if (this.running) return;
      this.run("AUTO").catch((err: unknown) =>
        logger.error(`[time-clock-roster] ${messageOf(err)}`)
      );
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }
}
