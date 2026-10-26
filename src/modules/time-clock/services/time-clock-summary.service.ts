import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { resolveTimezone, startOfLocalDay, localDateKey } from "@core/utils/timezone";
import { IsapiAuthError, IsapiClient } from "./isapi.client";
import type { TimeClockCredentials } from "./time-clock.service";
import {
  buildAlerts,
  classifyConnection,
  hourlyCounts,
  type ClockAlert,
  type ClockFacts,
  type ReadResult,
  type RosterFacts,
} from "./clock-summary";

/** Caché de lecturas del equipo: el resumen no le pide al reloj más de una vez por minuto. */
export const DEVICE_READ_TTL_MS = 60_000;

interface DeviceRead {
  at: number;
  read: ReadResult;
  device: { deviceName: string | null; model: string | null; firmwareVersion: string | null } | null;
  counts: { people: number; cards: number } | null;
}

const EMPTY_ROSTER: RosterFacts = { suspicious: false, pendingRemovals: 0, reappeared: 0, unlinked: 0 };

/**
 * Resumen de estado del reloj para el dashboard (RELOJ_DASHBOARD.md §4.1).
 * Junta la base de datos (checadas de hoy, sincronización, padrón) con una
 * lectura del equipo que se guarda en caché. Solo LEE del reloj.
 */
export class TimeClockSummaryService {
  private readonly cache = new Map<string, DeviceRead>();

  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly credentials: TimeClockCredentials | null = null,
    private readonly now: () => Date = () => new Date(),
    private readonly readDevice: (url: string) => Promise<DeviceRead["device"] & { counts: DeviceRead["counts"] }> = (url) =>
      this.defaultRead(url)
  ) {}

  private async defaultRead(url: string) {
    if (!this.credentials) throw new Error("no credentials");
    const { user, pass } = this.credentials;
    const client = new IsapiClient(url, user, pass);
    const [info, count] = await Promise.all([client.deviceInfo(), client.userCount()]);
    return {
      deviceName: info.deviceName,
      model: info.model,
      firmwareVersion: info.firmwareVersion,
      counts: { people: count.userNumber, cards: count.bindCardUserNumber },
    };
  }

  /** Lectura del equipo con caché; `null` si no se puede intentar. */
  private async deviceFor(serial: string, url: string | null): Promise<DeviceRead> {
    const hit = this.cache.get(serial);
    const nowMs = this.now().getTime();
    if (hit && nowMs - hit.at < DEVICE_READ_TTL_MS) return hit;
    if (!this.credentials || !url) {
      return { at: nowMs, read: null, device: null, counts: null };
    }
    try {
      const data = await this.readDevice(url);
      const entry: DeviceRead = {
        at: nowMs,
        read: { ok: true },
        device: { deviceName: data.deviceName, model: data.model, firmwareVersion: data.firmwareVersion },
        counts: data.counts,
      };
      this.cache.set(serial, entry);
      return entry;
    } catch (err) {
      const entry: DeviceRead = {
        at: nowMs,
        read: { ok: false, authError: err instanceof IsapiAuthError, message: err instanceof Error ? err.message : String(err) },
        device: null,
        counts: null,
      };
      this.cache.set(serial, entry);
      return entry;
    }
  }

  /** Padrón visto desde la base (sin tocar el reloj). */
  private async rosterFacts(): Promise<RosterFacts> {
    const lastRun = await this.db.timeClockRosterRun.findFirst({ orderBy: { startedAt: "desc" }, select: { suspicious: true } });
    const pendingRemovals = await this.db.timeClockEmployee.count({
      where: { status: "PENDING_REMOVAL", user: { active: true } },
    });
    const reappeared = await this.db.timeClockEmployee.count({
      where: { reappearedAt: { not: null }, user: { active: false } },
    });
    const rosterNumbers = await this.db.timeClockRosterEntry.findMany({
      where: { clock: { countsAttendance: true, url: { not: null } } },
      select: { employeeNumber: true },
      distinct: ["employeeNumber"],
    });
    const linked = await this.db.timeClockEmployee.findMany({ select: { employeeNumber: true } });
    const linkedSet = new Set(linked.map((l) => l.employeeNumber));
    return {
      suspicious: lastRun?.suspicious ?? false,
      pendingRemovals,
      reappeared,
      unlinked: rosterNumbers.filter((r) => !linkedSet.has(r.employeeNumber)).length,
    };
  }

  /** Resumen completo: global (padrón) y por reloj. */
  async summary() {
    const now = this.now();
    const tz = resolveTimezone(null);
    const dayStart = startOfLocalDay(localDateKey(now, tz), tz);
    const clocks = await this.db.timeClock.findMany({
      where: { url: { not: null } },
      select: { serialNumber: true, name: true, url: true, countsAttendance: true, syncedAt: true },
      orderBy: { createdAt: "asc" },
    });

    const roster = await this.rosterFacts();
    const rows = [];
    for (const clock of clocks) {
      const device = await this.deviceFor(clock.serialNumber, clock.url);
      const lastSync = await this.db.timeClockSyncEvent.findFirst({
        where: { clockSerial: clock.serialNumber },
        orderBy: { startedAt: "desc" },
        select: { ok: true, error: true, startedAt: true },
      });
      const todays = clock.countsAttendance
        ? await this.db.timeClockPunch.findMany({
            where: { clockSerial: clock.serialNumber, occurredAt: { gte: dayStart } },
            select: { occurredAt: true, employeeNumber: true, name: true, method: true },
            orderBy: { occurredAt: "desc" },
          })
        : [];
      const facts: ClockFacts = {
        serial: clock.serialNumber,
        name: clock.name,
        countsAttendance: clock.countsAttendance,
        connection: classifyConnection(device.read),
        lastSyncAt: clock.syncedAt,
        lastSyncOk: lastSync ? lastSync.ok : null,
        lastSyncError: lastSync?.error ?? null,
      };
      const alerts: ClockAlert[] = buildAlerts(facts, { ...EMPTY_ROSTER, suspicious: false });
      rows.push({
        serial: clock.serialNumber,
        name: clock.name,
        countsAttendance: clock.countsAttendance,
        connection: facts.connection,
        lastReadAt: device.read ? new Date(device.at).toISOString() : null,
        lastSyncAt: clock.syncedAt,
        lastSyncOk: facts.lastSyncOk,
        device: device.device,
        counts: device.counts,
        punchesToday: todays.length,
        hourly: clock.countsAttendance ? hourlyCounts(todays, tz, now) : [],
        recentPunches: todays.slice(0, 8).map((p) => ({
          occurredAt: p.occurredAt.toISOString(),
          employeeNumber: p.employeeNumber,
          name: p.name,
          method: p.method,
        })),
        alerts,
      });
    }

    // Alertas del padrón (globales): una sola vez, no por reloj.
    const globalAlerts = buildAlerts(
      { serial: "", name: null, countsAttendance: true, connection: "ONLINE", lastSyncAt: null, lastSyncOk: true, lastSyncError: null },
      roster
    );
    return { generatedAt: now.toISOString(), timezone: tz, roster, alerts: globalAlerts, clocks: rows };
  }
}
