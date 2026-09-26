import { PunchMethod, type TimeClock, type Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { paginatedQuery } from "@core/db/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { logger } from "@core/utils/logger";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import {
  endOfLocalDay,
  parseDateFilter,
  resolveTimezoneWithConfig,
  startOfLocalDay,
} from "@core/utils/timezone";
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiAuthError, IsapiClient } from "./isapi.client";
import type {
  TimeClockImportInput,
  TimeClockInput,
  TimeClockUpdate,
} from "../models/dto/time-clock.dto";
import type {
  AcsEventInfo,
  TimeClockRun,
  TimeClockDeviceInfo,
  TimeClockDeviceStatus,
  TimeClockImport,
  TimeClockProgress,
  TimeClockConfig,
  TimeClockStatus,
} from "../models/entity/time-clock.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/** Usuario y contraseña de los relojes: los mismos para todos. */
export interface TimeClockCredentials {
  user: string;
  pass: string;
}

/** Un reloj dado de alta (tiene dirección). */
type RegisteredClock = TimeClock & { url: string };

const isRegistered = (clock: TimeClock | null): clock is RegisteredClock =>
  clock !== null && clock.url !== null;

/** Estado en memoria de la sincronización de un reloj. */
interface ClockStatus {
  /** Corrida en curso; también es el candado para no traslapar corridas del reloj. */
  inProgress: TimeClockProgress | null;
  lastRun: TimeClockRun | null;
  /** Rechazó las credenciales: el worker no lo vuelve a intentar solo. */
  pausedByCredentials: boolean;
  /** Se dio de baja a media corrida: la corrida para en la siguiente página. */
  stop: boolean;
}

/** La corrida se detuvo porque el reloj se dio de baja. */
class RetiredClock extends Error {
  constructor() {
    super("Se dio de baja durante la sincronización");
  }
}

/**
 * Espera máxima por el reloj cuando alguien espera la respuesta (alta y
 * configuración): la web corta a los 30 s y el reloj contesta en menos de 1 s.
 */
const TIMEOUT_INTERACTIVE_MS = 10_000;

/**
 * Consecutivos por ventana. Cada ventana terminada confirma el cursor y
 * actualiza el avance: un reinicio a media carga solo repite la ventana en
 * curso, no todo el historial.
 */
const WINDOW_SERIAL = 5000;

/** `minor` ISAPI (major 5) → cómo se identificó el empleado. */
const METHOD_BY_MINOR: Record<number, PunchMethod> = {
  1: "CARD", // tarjeta válida
  38: "FINGERPRINT", // huella coincide
  75: "FACE", // rostro coincide
};

/**
 * Lo único que se le pide al reloj: las checadas válidas. Los eventos de
 * puerta (abrir/cerrar) y los intentos fallidos no se leen; en un reloj de
 * oficina son más del 90% de los eventos.
 */
const MINORS_PUNCH = Object.keys(METHOD_BY_MINOR).map(Number);

const punchSelect = {
  id: true,
  clockSerial: true,
  serialNo: true,
  employeeNumber: true,
  name: true,
  method: true,
  minor: true,
  occurredAt: true,
  createdAt: true,
} satisfies Prisma.TimeClockPunchSelect;

type PunchRow = Prisma.TimeClockPunchGetPayload<{ select: typeof punchSelect }>;

const assertMethod = (value: unknown): PunchMethod => {
  const method = String(value).toUpperCase();
  if (!(Object.values(PunchMethod) as string[]).includes(method)) {
    throw new HttpError(400, {
      code: "INVALID_METHOD",
      message: `Método "${String(value)}" inválido (ROSTRO, HUELLA, TARJETA u OTRO)`,
    });
  }
  return method as PunchMethod;
};

/**
 * La dirección del reloj como la escriben (`192.168.1.132`, o la URL copiada
 * del navegador, con ruta y `#`) → `http(s)://host[:puerto]`. Sin esquema se
 * asume https.
 */
const normalizeUrl = (value: string): string => {
  const invalid = new HttpError(400, {
    code: "INVALID_URL",
    message: `"${value}" no es una dirección válida (p. ej. https://192.168.1.132)`,
  });
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw invalid;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw invalid;
  }
  return url.origin;
};

/** Evento ISAPI → fila de `checadas`; `null` si el reloj mandó una hora ilegible. */
const toPunch = (
  clockSerial: string,
  e: AcsEventInfo
): Prisma.TimeClockPunchCreateManyInput | null => {
  const occurredAt = new Date(e.time);
  if (Number.isNaN(occurredAt.getTime())) {
    logger.warn(`[checador] evento ${e.serialNo} con hora ilegible ("${e.time}"): se omite`);
    return null;
  }
  return {
    clockSerial,
    serialNo: e.serialNo,
    employeeNumber: e.employeeNoString ?? "",
    name: e.name?.trim() ?? "",
    method: METHOD_BY_MINOR[e.minor] ?? "OTHER",
    minor: e.minor,
    occurredAt,
  };
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class TimeClockService {
  /** Estado de la sincronización de cada reloj, por serie. */
  private readonly statuses = new Map<string, ClockStatus>();
  /** Importación manual en curso o la última (en curso ⇔ `finishedAt` null). */
  private importJob: TimeClockImport | null = null;

  constructor(
    private readonly db: PrismaClient = prismaClient,
    /** `null` sin `CHECADOR_USER`: las checadas se consultan, pero no se sincroniza. */
    private readonly credentials: TimeClockCredentials | null = null,
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
  ) {}

  // ── Consulta ────────────────────────────────────────────────────────────

  /** Tabla server-side de las checadas guardadas (contrato ITDataTable). */
  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<unknown>> {
    const { filters } = params;
    const tz = await resolveTimezoneWithConfig(
      typeof filters.tz === "string" ? filters.tz : undefined,
      this.sysConfig
    );

    const where: Prisma.TimeClockPunchWhereInput = {};
    if (typeof filters.q === "string" && filters.q.trim() !== "") {
      const q = filters.q.trim();
      where.OR = [{ name: ci(q) }, { employeeNumber: ci(q) }];
    }
    if (filters.employeeNumber !== undefined) where.employeeNumber = String(filters.employeeNumber);
    if (filters.clockSerial !== undefined) where.clockSerial = String(filters.clockSerial);
    if (filters.method !== undefined) where.method = assertMethod(filters.method);

    const from = parseDateFilter(filters.from, tz, "start");
    const to = parseDateFilter(filters.to, tz, "end");
    if (from || to) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (from) occurredAt.gte = from;
      if (to) {
        // `YYYY-MM-DD` se resuelve como inicio del día siguiente (exclusivo);
        // un instante absoluto (con `T`) se respeta inclusive.
        if (String(filters.to).includes("T")) occurredAt.lte = to;
        else occurredAt.lt = to;
      }
      where.occurredAt = occurredAt;
    }

    // Desempate estable al final: sin él, filas con el mismo valor de orden (un
    // mismo nombre tiene cientos de checadas) se repiten o saltan entre páginas.
    const orderBy = [
      ...orderByOf(
        params.sort,
        { occurredAt: "occurredAt", name: "name", employeeNumber: "employeeNumber", method: "method" },
        [{ occurredAt: "desc" }]
      ),
      { serialNo: "desc" },
      { id: "asc" },
    ];

    const [page, clocks] = await Promise.all([
      paginatedQuery<PunchRow>({
        model: this.db.timeClockPunch,
        where: where as Record<string, unknown>,
        orderBy,
        select: punchSelect,
        page: params.page,
        limit: params.limit,
      }),
      this.db.timeClock.findMany({ select: { serialNumber: true, name: true } }),
    ]);
    // El nombre del reloj se queda aunque se dé de baja: sus checadas lo conservan.
    const names = new Map(clocks.map((r) => [r.serialNumber, r.name]));
    return {
      ...page,
      data: page.data.map((c) => ({ ...c, clock: names.get(c.clockSerial) ?? null })),
    };
  }

  async status(): Promise<TimeClockStatus> {
    return {
      configured: this.credentials !== null,
      inProgress: this.inProgressTotal(),
      importJob: this.importJob,
      devices: await this.statusOf(await this.registeredClocks()),
    };
  }

  // ── Relojes: alta, baja y configuración (del reloj solo se LEE) ──────────

  /**
   * Da de alta un reloj. Antes lee su identidad, que confirma la dirección y
   * las credenciales y da su serie, y luego arranca su primera sincronización.
   * Un reloj que ya estuvo dado de alta sigue desde su cursor.
   */
  async register(input: TimeClockInput, actorId?: string): Promise<TimeClockDeviceStatus> {
    const url = normalizeUrl(input.url);
    const client = this.client(url, TIMEOUT_INTERACTIVE_MS);
    const sameUrl = await this.db.timeClock.findUnique({ where: { url } });
    if (sameUrl) throw this.duplicate(sameUrl);

    const info = await this.connect(client, url);
    const previous = await this.db.timeClock.findUnique({
      where: { serialNumber: info.serialNumber },
    });
    if (previous?.url) throw this.duplicate(previous);

    const name = input.name?.trim() || info.deviceName || info.serialNumber;
    const countsAttendance = input.countsAttendance ?? true;
    const clock = await this.db.timeClock.upsert({
      where: { serialNumber: info.serialNumber },
      create: { serialNumber: info.serialNumber, url, name, countsAttendance, model: info.model },
      update: { url, name, countsAttendance, model: info.model },
    });
    if (!isRegistered(clock)) throw new Error("El reloj quedó sin dirección");
    await this.audit?.({
      action: "TIME_CLOCK_REGISTERED",
      entityType: "TimeClock",
      entityId: clock.serialNumber,
      userId: actorId,
      metadata: { url, name, countsAttendance, model: info.model },
    });

    // Un alta es un intento explícito: quita una pausa por credenciales previa.
    const clockStatus = this.clockStatus(clock.serialNumber);
    clockStatus.pausedByCredentials = false;
    clockStatus.stop = false;
    if (!clockStatus.inProgress) void this.run(clock);
    const [row] = await this.statusOf([clock]);
    return row;
  }

  /**
   * Cambia cómo usa el sistema al reloj: su nombre y si sus checadas cuentan
   * para entradas/salidas. Solo es el registro del sistema: el reloj no se toca.
   */
  async update(
    serial: string,
    input: TimeClockUpdate,
    actorId?: string
  ): Promise<TimeClockDeviceStatus> {
    const before = await this.findRegisteredClock(serial);
    const clock = await this.db.timeClock.update({
      where: { serialNumber: serial },
      data: { name: input.name?.trim(), countsAttendance: input.countsAttendance },
    });
    if (!isRegistered(clock)) throw new Error("El reloj quedó sin dirección");
    await this.audit?.({
      action: "TIME_CLOCK_UPDATED",
      entityType: "TimeClock",
      entityId: serial,
      userId: actorId,
      metadata: {
        before: { name: before.name, countsAttendance: before.countsAttendance },
        after: { name: clock.name, countsAttendance: clock.countsAttendance },
      },
    });
    const [row] = await this.statusOf([clock]);
    return row;
  }

  /** Da de baja un reloj: deja de sincronizarse; su cursor y sus checadas se quedan. */
  async retire(serial: string, actorId?: string): Promise<{ clockSerial: string }> {
    const clock = await this.findRegisteredClock(serial);
    await this.db.timeClock.update({ where: { serialNumber: serial }, data: { url: null } });
    const clockStatus = this.statuses.get(serial);
    if (clockStatus?.inProgress) clockStatus.stop = true;
    await this.audit?.({
      action: "TIME_CLOCK_RETIRED",
      entityType: "TimeClock",
      entityId: serial,
      userId: actorId,
      metadata: { url: clock.url, name: clock.name },
    });
    return { clockSerial: serial };
  }

  /**
   * Configuración del reloj leída en vivo (identidad, hora y personas dadas de
   * alta). Solo lectura: nada de esto se puede cambiar desde aquí.
   */
  async settings(serial: string): Promise<TimeClockConfig> {
    const clock = await this.findRegisteredClock(serial);
    const client = this.client(clock.url, TIMEOUT_INTERACTIVE_MS);
    const info = await this.connect(client, clock.url);
    this.verifySerial(clock, info);

    const optional = <T>(request: Promise<T>, that: string): Promise<T | null> =>
      request.catch((err: unknown) => {
        logger.warn(`[checador] ${clock.name ?? serial}: no se pudo leer ${that}: ${messageOf(err)}`);
        return null;
      });
    const [hour, people] = await Promise.all([
      optional(
        client.time().then((t) => ({
          localTime: t.localTime,
          mode: t.timeMode,
          zone: t.timeZone,
          // El reloj trunca los segundos: su hora real está en [hora, hora + 1 s),
          // así que se compara contra la mitad. Se mide al recibir la respuesta.
          driftSeconds: Math.round((t.instant.getTime() + 500 - Date.now()) / 1000),
        })),
        "la hora"
      ),
      optional(
        client.userCount().then((c) => ({
          total: c.userNumber,
          withFace: c.bindFaceUserNumber,
          withFingerprint: c.bindFingerprintUserNumber,
          withCard: c.bindCardUserNumber,
        })),
        "las personas"
      ),
    ]);

    return {
      clockSerial: serial,
      readAt: new Date(),
      device: {
        name: info.deviceName,
        model: info.model,
        firmware: info.firmwareVersion,
        mac: info.macAddress,
      },
      hour,
      people,
    };
  }

  // ── Sincronización (solo lectura de los relojes) ────────────────────────

  /**
   * Importación manual por rango de días (`POST /checador/import`): lee de
   * todos los relojes los eventos de esos días y guarda las checadas que
   * falten. Corre en segundo plano, tarde lo que tarde, y su avance sale en
   * `status()`. Es independiente de la sincronización periódica y del cursor:
   * puede correr a la vez, y los duplicados se descartan por el `@@unique`.
   */
  async startImport(input: TimeClockImportInput): Promise<TimeClockImport> {
    if (input.from > input.to) {
      throw new HttpError(400, {
        code: "INVALID_RANGE",
        message: "La fecha inicial no puede ser posterior a la final",
      });
    }
    const tz = await resolveTimezoneWithConfig(input.tz, this.sysConfig);
    const start = startOfLocalDay(input.from, tz);
    // El reloj toma `endTime` inclusive: último segundo del día `hasta`.
    const end = new Date(endOfLocalDay(input.to, tz).getTime() - 1000);

    const clocks = await this.clocksToRead();
    if (this.importJob && !this.importJob.finishedAt) {
      throw new HttpError(409, {
        code: "TIME_CLOCK_IMPORT_IN_PROGRESS",
        message: "Ya hay una importación en curso; espera a que termine",
      });
    }

    const importJob: TimeClockImport = {
      from: input.from,
      to: input.to,
      startedAt: new Date(),
      finishedAt: null,
      total: null,
      readCount: 0,
      newCount: 0,
      error: null,
    };
    this.importJob = importJob;
    void this.runImport(clocks, importJob, start, end);
    return importJob;
  }

  /**
   * Sincronización periódica: cada `intervalMs` (y al arrancar) lee a los
   * relojes dados de alta. Cada reloj va por su lado: uno lento o caído no
   * detiene a los demás, y uno que rechaza las credenciales se pausa solo él
   * hasta reiniciar la API (o hasta un reintento manual).
   */
  startWorker(intervalMs: number): () => void {
    if (!this.credentials) {
      logger.info("[checador] sin CHECADOR_USER/CHECADOR_PASS: sincronización deshabilitada");
      return () => undefined;
    }
    const tick = async (): Promise<void> => {
      try {
        for (const clock of await this.registeredClocks()) {
          const clockStatus = this.clockStatus(clock.serialNumber);
          if (!clockStatus.inProgress && !clockStatus.pausedByCredentials) void this.run(clock);
        }
      } catch (err) {
        logger.error(`[checador] no se pudieron leer los relojes dados de alta: ${messageOf(err)}`);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(timer);
  }

  /**
   * `POST /checador/sync`: drena de cada reloj **todo lo que falte** desde su
   * cursor, sin esperar al worker. Es la misma corrida que hace el worker y
   * comparte su candado: se arranca en los relojes que no estén corriendo y, si
   * todos lo están, 409. Se permite aunque un reloj esté en pausa por
   * credenciales (es un reintento explícito, de un solo intento; si acierta, la
   * corrida limpia la pausa). Responde 202 y el avance sale en `status()`.
   */
  async sync(): Promise<TimeClockProgress> {
    const free = (await this.clocksToRead()).filter((r) => !this.clockStatus(r.serialNumber).inProgress);
    if (free.length === 0) {
      throw new HttpError(409, {
        code: "TIME_CLOCK_SYNC_IN_PROGRESS",
        message: "Ya hay una sincronización en curso; espera a que termine",
      });
    }
    // `run` fija `enCurso` de forma síncrona antes de su primer `await`.
    for (const clock of free) void this.run(clock);
    return this.inProgressTotal()!;
  }

  /** Nunca lanza: el resultado (ok o error) queda en `ultimaCorrida` del reloj. */
  private async run(clock: RegisteredClock): Promise<void> {
    const serial = clock.serialNumber;
    const name = clock.name ?? serial;
    const clockStatus = this.clockStatus(serial);
    const progress: TimeClockProgress = {
      startedAt: new Date(),
      readCount: 0,
      newCount: 0,
      remaining: null,
      total: null,
    };
    clockStatus.inProgress = progress;
    clockStatus.stop = false;
    let confirmed: number | null = null;
    let run: TimeClockRun;

    try {
      const client = this.client(clock.url);
      this.verifySerial(clock, await client.deviceInfo());
      const cursor = await this.db.timeClock.findUniqueOrThrow({ where: { serialNumber: serial } });
      confirmed = cursor.lastSerialNo;
      const confirm = async (lastSerialNo: number): Promise<void> => {
        await this.db.timeClock.update({
          where: { serialNumber: serial },
          data: { lastSerialNo, syncedAt: new Date() },
        });
        confirmed = lastSerialNo;
      };

      // Hasta dónde leer en esta corrida: todo consecutivo menor ya existe en
      // el reloj, así que al llegar ahí el cursor es exacto. Lo que entre
      // mientras tanto lo lee la siguiente corrida.
      const to = await client.lastSerialNo(cursor.lastSerialNo + 1);
      let lastSerialNo = cursor.lastSerialNo;
      if (to !== null && to > cursor.lastSerialNo) {
        progress.total = to - cursor.lastSerialNo;
        progress.remaining = progress.total;
        for (let from = cursor.lastSerialNo + 1; from <= to; from += WINDOW_SERIAL) {
          const end = Math.min(from + WINDOW_SERIAL - 1, to);
          for (const minor of MINORS_PUNCH) {
            for await (const { events } of client.acsEvents(from, end, minor)) {
              if (clockStatus.stop) throw new RetiredClock();
              progress.newCount += await this.save(serial, events);
            }
          }
          await confirm(end);
          lastSerialNo = end;
          // El avance es en consecutivos (eventos del reloj) revisados.
          progress.readCount = end - cursor.lastSerialNo;
          progress.remaining = to - end;
        }
      } else {
        await confirm(lastSerialNo); // nada nuevo: solo queda la hora de la revisión
      }

      clockStatus.pausedByCredentials = false;
      if (progress.newCount > 0) {
        logger.info(
          `[checador] ${name}: ${progress.newCount} checadas nuevas (${progress.readCount} eventos revisados, consecutivo ${lastSerialNo})`
        );
      }
      run = {
        ok: true,
        clockSerial: serial,
        startedAt: progress.startedAt,
        finishedAt: new Date(),
        readCount: progress.readCount,
        newCount: progress.newCount,
        lastSerialNo,
        error: null,
      };
    } catch (err) {
      const error = messageOf(err);
      if (err instanceof IsapiAuthError) {
        clockStatus.pausedByCredentials = true;
        logger.error(
          `[checador] ${name}: ${error}. Sincronización automática en pausa hasta reiniciar la API, para no bloquear la cuenta en el reloj.`
        );
      } else if (err instanceof RetiredClock) {
        logger.info(`[checador] ${name}: dado de baja, se detuvo su sincronización`);
      } else {
        logger.error(`[checador] ${name}: sincronización fallida: ${error}`);
      }
      run = {
        ok: false,
        clockSerial: serial,
        startedAt: progress.startedAt,
        finishedAt: new Date(),
        readCount: progress.readCount,
        newCount: progress.newCount,
        lastSerialNo: confirmed,
        error,
      };
    } finally {
      clockStatus.inProgress = null;
    }
    clockStatus.lastRun = run;
  }

  /** Nunca lanza: el resultado (o los errores por reloj) queda en la misma `importacion`. */
  private async runImport(
    clocks: RegisteredClock[],
    importJob: TimeClockImport,
    start: Date,
    end: Date
  ): Promise<void> {
    const range = `${importJob.from} a ${importJob.to}`;
    // Checadas del rango por reloj y método (se conocen con la primera página
    // de cada búsqueda); el total se publica cuando ya se conocen todas.
    const totals = new Map<string, number>();
    const expected = clocks.length * MINORS_PUNCH.length;
    const setTotal = (key: string, total: number): void => {
      if (totals.has(key)) return;
      totals.set(key, total);
      importJob.total =
        totals.size === expected ? [...totals.values()].reduce((a, n) => a + n, 0) : null;
    };
    const errors: string[] = [];

    await Promise.all(
      clocks.map(async (clock) => {
        const serial = clock.serialNumber;
        const name = clock.name ?? serial;
        try {
          const client = this.client(clock.url);
          this.verifySerial(clock, await client.deviceInfo());
          for (const minor of MINORS_PUNCH) {
            for await (const { totalMatches, events } of client.acsEventsBetween(start, end, minor)) {
              setTotal(`${serial}/${minor}`, totalMatches);
              importJob.readCount += events.length;
              importJob.newCount += await this.save(serial, events);
            }
            // Sin checadas de ese método en el rango, la búsqueda no da total.
            setTotal(`${serial}/${minor}`, 0);
          }
        } catch (err) {
          const error = messageOf(err);
          if (err instanceof IsapiAuthError) this.clockStatus(serial).pausedByCredentials = true;
          errors.push(`${name}: ${error}`);
          logger.error(`[checador] importación ${range} en ${name} fallida: ${error}`);
        } finally {
          // Si falló, lo que no alcanzó a reportar cuenta como cero.
          for (const minor of MINORS_PUNCH) setTotal(`${serial}/${minor}`, 0);
        }
      })
    );

    importJob.error = errors.length > 0 ? errors.join(" · ") : null;
    importJob.finishedAt = new Date();
    logger.info(
      `[checador] importación ${range}: ${importJob.newCount} checadas nuevas (${importJob.readCount} leídas de ${clocks.length} reloj(es))`
    );
  }

  /** Guarda las checadas de una página; devuelve cuántas eran nuevas (sin duplicados). */
  private async save(serial: string, events: AcsEventInfo[]): Promise<number> {
    // Solo con empleado identificado: una checada sin número no es de nadie.
    const data = events
      .filter((e) => e.employeeNoString)
      .map((e) => toPunch(serial, e))
      .filter((c): c is Prisma.TimeClockPunchCreateManyInput => c !== null);
    if (data.length === 0) return 0;
    const { count } = await this.db.timeClockPunch.createMany({ data, skipDuplicates: true });
    return count;
  }

  // ── Apoyo ───────────────────────────────────────────────────────────────

  private clockStatus(serial: string): ClockStatus {
    let clockStatus = this.statuses.get(serial);
    if (!clockStatus) {
      clockStatus = { inProgress: null, lastRun: null, pausedByCredentials: false, stop: false };
      this.statuses.set(serial, clockStatus);
    }
    return clockStatus;
  }

  /** Suma de las corridas en curso de todos los relojes (`null` si no corre ninguna). */
  private inProgressTotal(): TimeClockProgress | null {
    const runs = [...this.statuses.values()]
      .map((e) => e.inProgress)
      .filter((p): p is TimeClockProgress => p !== null);
    if (runs.length === 0) return null;
    const sum = (field: "readCount" | "newCount"): number => runs.reduce((a, p) => a + p[field], 0);
    // Un total parcial prometería de menos: solo se da cuando todos lo conocen.
    const knownSum = (field: "total" | "remaining"): number | null =>
      runs.every((p) => p[field] != null) ? runs.reduce((a, p) => a + (p[field] ?? 0), 0) : null;
    return {
      startedAt: new Date(Math.min(...runs.map((p) => p.startedAt.getTime()))),
      readCount: sum("readCount"),
      newCount: sum("newCount"),
      remaining: knownSum("remaining"),
      total: knownSum("total"),
    };
  }

  private async statusOf(clocks: RegisteredClock[]): Promise<TimeClockDeviceStatus[]> {
    if (clocks.length === 0) return [];
    const totals = await this.db.timeClockPunch.groupBy({
      by: ["clockSerial"],
      where: { clockSerial: { in: clocks.map((r) => r.serialNumber) } },
      _count: { _all: true },
      _max: { occurredAt: true },
    });
    const bySerial = new Map(totals.map((t) => [t.clockSerial, t]));
    return clocks.map((r) => {
      const clockStatus = this.statuses.get(r.serialNumber);
      const total = bySerial.get(r.serialNumber);
      return {
        clockSerial: r.serialNumber,
        name: r.name ?? r.serialNumber,
        url: r.url,
        countsAttendance: r.countsAttendance,
        model: r.model,
        lastSerialNo: r.lastSerialNo,
        syncedAt: r.syncedAt,
        punches: total?._count._all ?? 0,
        lastPunch: total?._max.occurredAt ?? null,
        inProgress: clockStatus?.inProgress ?? null,
        lastRun: clockStatus?.lastRun ?? null,
        pausedByCredentials: clockStatus?.pausedByCredentials ?? false,
      };
    });
  }

  private async registeredClocks(): Promise<RegisteredClock[]> {
    const clocks = await this.db.timeClock.findMany({
      where: { url: { not: null } },
      orderBy: [{ name: "asc" }, { serialNumber: "asc" }],
    });
    return clocks.filter(isRegistered);
  }

  private async findRegisteredClock(serial: string): Promise<RegisteredClock> {
    const clock = await this.db.timeClock.findUnique({ where: { serialNumber: serial } });
    if (!isRegistered(clock)) {
      throw new HttpError(404, {
        code: "TIME_CLOCK_NOT_FOUND",
        message: "Ese reloj no está dado de alta",
      });
    }
    return clock;
  }

  /** Relojes para sincronizar o importar; 503 si no hay credenciales o ninguno dado de alta. */
  private async clocksToRead(): Promise<RegisteredClock[]> {
    this.requireCredentials();
    const clocks = await this.registeredClocks();
    if (clocks.length === 0) {
      throw new HttpError(503, {
        code: "TIME_CLOCK_NOT_CONFIGURED",
        message: "No hay relojes dados de alta",
      });
    }
    return clocks;
  }

  private requireCredentials(): TimeClockCredentials {
    if (!this.credentials) {
      throw new HttpError(503, {
        code: "TIME_CLOCK_NOT_CONFIGURED",
        message: "La API no tiene el usuario de los relojes (CHECADOR_USER / CHECADOR_PASS)",
      });
    }
    return this.credentials;
  }

  private client(url: string, timeoutMs?: number): IsapiClient {
    const { user, pass } = this.requireCredentials();
    return new IsapiClient(url, user, pass, timeoutMs);
  }

  /** Identidad del reloj; si no contesta o rechaza las credenciales, 502 con el motivo. */
  private async connect(client: IsapiClient, url: string): Promise<TimeClockDeviceInfo> {
    try {
      return await client.deviceInfo();
    } catch (err) {
      if (err instanceof IsapiAuthError) {
        throw new HttpError(502, {
          code: "TIME_CLOCK_INVALID_CREDENTIALS",
          message: `${url} rechazó el usuario y la contraseña (CHECADOR_USER / CHECADOR_PASS)`,
        });
      }
      throw new HttpError(502, { code: "TIME_CLOCK_UNREACHABLE", message: messageOf(err) });
    }
  }

  /** La dirección dada de alta tiene que seguir respondiendo el mismo reloj. */
  private verifySerial(clock: RegisteredClock, info: TimeClockDeviceInfo): void {
    if (info.serialNumber !== clock.serialNumber) {
      throw new HttpError(409, {
        code: "TIME_CLOCK_SERIAL_CHANGED",
        message: `${clock.url} ahora responde otro reloj (serie ${info.serialNumber}): da de baja "${clock.name ?? clock.serialNumber}" y da de alta el nuevo`,
      });
    }
  }

  private duplicate(clock: TimeClock): HttpError {
    return new HttpError(409, {
      code: "TIME_CLOCK_DUPLICATE",
      message: `Ese reloj ya está dado de alta como "${clock.name ?? clock.serialNumber}" (${clock.url})`,
    });
  }
}
