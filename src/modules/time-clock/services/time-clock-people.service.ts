import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiAuthError, IsapiClient } from "./isapi.client";
import type { TimeClockCredentials } from "./time-clock.service";

const MAX_PEOPLE = 1000;
const MAX_CARDS = 1000;
/** Las huellas y rostros se leen persona por persona: se guarda el resultado un rato. */
const BIOMETRICS_TTL_MS = 10 * 60 * 1000;
const BIOMETRICS_CONCURRENCY = 6;

/** Calidad mínima (1 a 100) para aceptar una huella capturada. */
const MIN_FINGER_QUALITY = 60;
/** La captura espera en memoria (nunca en la base) a que se confirme o caduque. */
const CAPTURE_TTL_MS = 2 * 60 * 1000;
const MAX_FINGERS_PER_PERSON = 10;
/** El alta de huella es asíncrona: se consulta el progreso hasta 10 veces, cada 500 ms. */
const APPLY_POLLS = 10;
const APPLY_POLL_MS = 500;

interface PendingCapture {
  serial: string;
  employeeNumber: string;
  fingerNo: number;
  quality: number;
  /** Plantilla en base64. Solo en memoria; no se registra ni se guarda. */
  fingerData: string;
  expiresAt: number;
}

/** Estación de enrolamiento por red: solo se usa para capturar huellas (no recibe escrituras). */
export interface FingerprintStation {
  url: string;
  user: string;
  pass: string;
}

export interface PersonBiometrics {
  faces: number;
  fingerprints: number;
}

/** Tiempo máximo para leer el estado de un reloj en la ficha de una persona. */
const STATUS_READ_TIMEOUT_MS = 10_000;

/** Solo estas direcciones se pueden escribir sin permiso explícito: el mock local. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Personas y tarjetas de un reloj registrado: listar, dar de alta, renombrar,
 * dar de baja, y registrar o quitar tarjetas.
 *
 * ESCRIBE en el reloj, así que tiene un candado: solo acepta relojes locales
 * (el mock) o, si `allowWrites` es verdadero (TIME_CLOCK_WRITE_ENABLED), los
 * demás. Mientras eso no se active, los relojes reales son de solo lectura.
 */
export class TimeClockPeopleService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly credentials: TimeClockCredentials | null = null,
    private readonly audit?: AuditLogger,
    private readonly allowWrites = false,
    private readonly station: FingerprintStation | null = null
  ) {}

  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private readonly biometricsCache = new Map<string, { at: number; byEmployee: Record<string, PersonBiometrics> }>();

  private async clockFor(serial: string, write: boolean, timeoutMs?: number): Promise<{ client: IsapiClient; name: string | null }> {
    if (!this.credentials) throw new HttpError(503, "TIME_CLOCK_NOT_CONFIGURED");
    const clock = await this.db.timeClock.findUnique({ where: { serialNumber: serial } });
    if (!clock || !clock.url) throw new HttpError(404, "TIME_CLOCK_NOT_FOUND");
    if (write && !this.canWriteClock(clock)) throw new HttpError(403, "TIME_CLOCK_READ_ONLY");
    const { user, pass } = this.credentials;
    return { client: new IsapiClient(clock.url, user, pass, timeoutMs), name: clock.name };
  }

  /** Escritura permitida: el mock (local), el interruptor del reloj, o la variable global. */
  private canWriteClock(clock: { url: string | null; writeEnabled: boolean }): boolean {
    if (clock.writeEnabled || this.allowWrites) return true;
    return !!clock.url && this.canWrite(clock.url);
  }

  private canWrite(url: string): boolean {
    if (this.allowWrites) return true;
    try {
      return LOCAL_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  private async readAll(client: IsapiClient) {
    const people: Array<{ employeeNumber: string; name: string }> = [];
    for await (const page of client.users()) {
      people.push(...page.people);
      if (people.length >= MAX_PEOPLE) break;
    }
    const cards: Array<{ cardNo: string; employeeNumber: string; cardType: string | null }> = [];
    for await (const page of client.cards()) {
      cards.push(...page.cards);
      if (cards.length >= MAX_CARDS) break;
    }
    return { people, cards };
  }

  /** Personas del reloj con sus tarjetas. */
  async list(serial: string) {
    const { client } = await this.clockFor(serial, false);
    const { people, cards } = await this.readAll(client);
    // Usuario del sistema vinculado a cada número (para abrir su ficha unificada).
    const links = await this.db.timeClockEmployee.findMany({
      where: { employeeNumber: { in: people.map((p) => p.employeeNumber) } },
      select: { employeeNumber: true, userId: true },
    });
    const userByNumber = new Map(links.map((l) => [l.employeeNumber, l.userId]));
    return {
      people: people.map((p) => ({
        employeeNumber: p.employeeNumber,
        name: p.name,
        userId: userByNumber.get(p.employeeNumber) ?? null,
        cards: cards.filter((c) => c.employeeNumber === p.employeeNumber).map((c) => c.cardNo),
      })),
      cards,
    };
  }

  /**
   * Rostros y huellas (solo conteos) de cada persona. El equipo pide una persona
   * por consulta, así que se lee con poca concurrencia y se guarda en caché.
   */
  async biometrics(serial: string, refresh: boolean) {
    const cached = this.biometricsCache.get(serial);
    if (!refresh && cached && Date.now() - cached.at < BIOMETRICS_TTL_MS) {
      return { updatedAt: new Date(cached.at).toISOString(), people: cached.byEmployee };
    }
    const { client } = await this.clockFor(serial, false);
    const { people } = await this.readAll(client);
    const byEmployee: Record<string, PersonBiometrics> = {};
    let next = 0;
    // Una consulta por persona con FingerPrint/Count; si el equipo no la soporta, se recorre dedo por dedo.
    let countSupported = true;
    const fingerprintTotal = async (employeeNumber: string): Promise<number> => {
      if (countSupported) {
        const total = await client.fingerprintCount(employeeNumber);
        if (total !== null) return total;
        countSupported = false;
      }
      return (await client.fingerprints(employeeNumber)).length;
    };
    const worker = async () => {
      while (next < people.length) {
        const person = people[next++];
        const [faces, fingerprints] = await Promise.all([
          client.faceRecords(person.employeeNumber),
          fingerprintTotal(person.employeeNumber),
        ]);
        byEmployee[person.employeeNumber] = { faces: faces.length, fingerprints };
      }
    };
    await Promise.all(Array.from({ length: BIOMETRICS_CONCURRENCY }, worker));
    const at = Date.now();
    this.biometricsCache.set(serial, { at, byEmployee });
    return { updatedAt: new Date(at).toISOString(), people: byEmployee };
  }

  /** Persona del sistema: su número y nombre son los que se dan de alta en el reloj. */
  private async userFor(userId: string): Promise<{ name: string; employeeNumber: string | null }> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { name: true, employeeNumber: true } });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND");
    return user;
  }

  /**
   * Estado del alta de una persona del sistema en cada reloj registrado:
   * `DADA_DE_ALTA` si el reloj tiene su número, `SIN_ALTA` si no. Solo lee.
   * `canAlta` indica si ese reloj acepta altas desde la web (hoy, solo el mock).
   */
  async employeeClockStatus(userId: string) {
    const user = await this.userFor(userId);
    const clocks = await this.db.timeClock.findMany({ where: { url: { not: null } }, orderBy: { name: "asc" } });
    // Los relojes se consultan a la vez y con un tiempo corto: uno apagado no debe
    // dejar esperando a la pantalla (que corta a los 30 s).
    const rows = await Promise.all(
      clocks.map(async (clock) => {
        const canAlta = this.canWriteClock(clock);
        const countsAttendance = clock.countsAttendance;
        try {
          const { client } = await this.clockFor(clock.serialNumber, false, STATUS_READ_TIMEOUT_MS);
          const { people } = await this.readAll(client);
          const present = !!user.employeeNumber && people.some((p) => p.employeeNumber === user.employeeNumber);
          return { serial: clock.serialNumber, name: clock.name, connection: "ONLINE" as const, state: present ? ("DADA_DE_ALTA" as const) : ("SIN_ALTA" as const), canAlta, countsAttendance };
        } catch {
          return { serial: clock.serialNumber, name: clock.name, connection: "NO_RESPONSE" as const, state: null, canAlta, countsAttendance };
        }
      })
    );
    return { employeeNumber: user.employeeNumber, clocks: rows };
  }

  /** Da de alta a la persona en el reloj indicado, con su número y nombre. Escribe: pasa por el candado de `create`. */
  async employeeClockAlta(userId: string, serial: string, actorId: string) {
    const user = await this.userFor(userId);
    if (!user.employeeNumber) throw new HttpError(422, "EMPLOYEE_NUMBER_REQUIRED");
    await this.create(serial, { employeeNumber: user.employeeNumber, name: user.name, gender: "unknown" }, actorId);
    return { serial, employeeNumber: user.employeeNumber, name: user.name };
  }

  /**
   * Alta automática al crear a la persona en Personal: la da de alta en cada
   * reloj que acepta escritura desde la web (hoy, solo el de prueba) y donde
   * todavía no está. Un reloj que falla no detiene a los demás.
   */
  async employeeClockAltaAll(userId: string, actorId: string) {
    const status = await this.employeeClockStatus(userId);
    const results: Array<{ serial: string; name: string; ok: boolean; code?: string }> = [];
    for (const clock of status.clocks) {
      // Solo los relojes que cuentan para entradas/salidas reciben el alta automática.
      // Si ya tiene a la persona, no hay nada que hacer.
      if (!clock.countsAttendance || clock.state === "DADA_DE_ALTA") continue;
      const name = clock.name ?? clock.serial;
      let result: { ok: boolean; code?: string };
      if (clock.connection !== "ONLINE") {
        result = { ok: false, code: "TIME_CLOCK_NO_RESPONSE" };
      } else if (!clock.canAlta) {
        // Relojes de solo lectura: el alta queda pendiente ahí (no se escribe).
        result = { ok: false, code: "TIME_CLOCK_READ_ONLY" };
      } else {
        try {
          await this.employeeClockAlta(userId, clock.serial, actorId);
          result = { ok: true };
        } catch (e) {
          result = { ok: false, code: e instanceof HttpError ? e.code : "UNKNOWN" };
        }
      }
      results.push({ serial: clock.serial, name, ...result });
      await this.log("TIME_CLOCK_ALTA_FROM_HR", clock.serial, actorId, { employeeNumber: status.employeeNumber, ...result });
    }
    return { results };
  }

  /**
   * Personas de todos los relojes con dirección, fusionadas por número de empleado.
   * Solo lee; un reloj que no responde se reporta aparte y no detiene a los demás.
   */
  async unifiedPeople() {
    const clocks = await this.db.timeClock.findMany({ where: { url: { not: null } }, orderBy: { name: "asc" } });
    const reads = await Promise.all(
      clocks.map(async (clock) => {
        const name = clock.name ?? clock.serialNumber;
        try {
          const { client } = await this.clockFor(clock.serialNumber, false);
          const { people } = await this.readAll(client);
          return { serial: clock.serialNumber, name, error: null as string | null, people };
        } catch (e) {
          return { serial: clock.serialNumber, name, error: e instanceof HttpError ? e.code : "TIME_CLOCK_NO_RESPONSE", people: [] };
        }
      })
    );
    const byNumber = new Map<string, { employeeNumber: string; name: string; presentIn: string[] }>();
    for (const read of reads) {
      for (const person of read.people) {
        const row = byNumber.get(person.employeeNumber) ?? { employeeNumber: person.employeeNumber, name: person.name, presentIn: [] };
        row.presentIn.push(read.serial);
        byNumber.set(person.employeeNumber, row);
      }
    }
    const people = [...byNumber.values()].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es", { numeric: true }));
    return { clocks: reads.map(({ serial, name, error }) => ({ serial, name, error })), people };
  }

  /** Número de huellas de una persona con una sola consulta (respaldo: recorrer dedos). */
  private async fingerprintTotal(client: IsapiClient, employeeNumber: string): Promise<number> {
    const total = await client.fingerprintCount(employeeNumber);
    return total !== null ? total : (await client.fingerprints(employeeNumber)).length;
  }

  /** Persona del sistema con número de empleado (el que lleva en el reloj). */
  private async userWithNumber(userId: string): Promise<{ name: string; employeeNumber: string }> {
    const user = await this.userFor(userId);
    if (!user.employeeNumber) throw new HttpError(422, "EMPLOYEE_NUMBER_REQUIRED");
    return { name: user.name, employeeNumber: user.employeeNumber };
  }

  /** Estado de huellas de una persona en un reloj. Solo lee (sirve también con relojes de solo lectura). */
  async fingerprintStatus(userId: string, serial: string) {
    const user = await this.userWithNumber(userId);
    const { client } = await this.clockFor(serial, false);
    // Un dedo por consulta: sabemos exactamente qué posiciones están ocupadas (para pintarlas).
    const fingerIds = (await client.fingerprints(user.employeeNumber)).map((f) => f.fingerPrintID).sort((a, b) => a - b);
    return { employeeNumber: user.employeeNumber, fingerIds, fingerprints: fingerIds.length, max: MAX_FINGERS_PER_PERSON };
  }

  /**
   * Baja de la persona en cada reloj donde está dada de alta. Mismo candado que el resto
   * de escrituras: en un reloj de solo lectura no se borra nada y se informa como pendiente.
   * Un reloj que falla no detiene a los demás.
   */
  async employeeClockBajaAll(userId: string, actorId: string) {
    const status = await this.employeeClockStatus(userId);
    const number = status.employeeNumber;
    const results: Array<{ serial: string; name: string; ok: boolean; code?: string }> = [];
    for (const clock of status.clocks) {
      if (clock.state !== "DADA_DE_ALTA" || !number) continue;
      const name = clock.name ?? clock.serial;
      if (!clock.canAlta) {
        results.push({ serial: clock.serial, name, ok: false, code: "TIME_CLOCK_READ_ONLY" });
        continue;
      }
      try {
        await this.remove(clock.serial, number, actorId);
        results.push({ serial: clock.serial, name, ok: true });
      } catch (e) {
        results.push({ serial: clock.serial, name, ok: false, code: e instanceof HttpError ? e.code : "UNKNOWN" });
      }
    }
    return { results };
  }

  /**
   * Paso 1 del alta de huella: captura con el sensor del reloj. Es una ACCIÓN sobre el
   * equipo, así que pasa por el candado de escritura (solo el mock o un reloj habilitado).
   * Devuelve un identificador de captura y su calidad; la plantilla se queda en memoria.
   */
  async captureFingerprint(userId: string, serial: string, fingerNo: number, actorId: string) {
    const user = await this.userWithNumber(userId);
    if (!this.station) throw new HttpError(503, "FINGERPRINT_STATION_NOT_CONFIGURED");
    const { client } = await this.clockFor(serial, false);
    const { people } = await this.readAll(client);
    if (!people.some((p) => p.employeeNumber === user.employeeNumber)) {
      throw new HttpError(404, "TIME_CLOCK_PERSON_NOT_FOUND");
    }
    if ((await this.fingerprintTotal(client, user.employeeNumber)) >= MAX_FINGERS_PER_PERSON) {
      throw new HttpError(409, "FINGERPRINT_LIMIT_REACHED", { max: MAX_FINGERS_PER_PERSON });
    }
    // La captura la hace la estación; el reloj no recibe nada en este paso.
    const stationClient = new IsapiClient(this.station.url, this.station.user, this.station.pass);
    const capture = await this.stationCall(() => stationClient.captureFingerPrint(fingerNo));
    const now = Date.now();
    for (const [id, pending] of this.pendingCaptures) if (pending.expiresAt < now) this.pendingCaptures.delete(id);
    const captureId = randomUUID();
    this.pendingCaptures.set(captureId, {
      serial,
      employeeNumber: user.employeeNumber,
      fingerNo,
      quality: capture.quality,
      fingerData: capture.fingerData,
      expiresAt: now + CAPTURE_TTL_MS,
    });
    // Nunca se registra la plantilla: solo dedo y calidad.
    await this.log("TIME_CLOCK_FINGERPRINT_CAPTURED", serial, actorId, { employeeNumber: user.employeeNumber, fingerNo, quality: capture.quality });
    return { captureId, fingerNo, quality: capture.quality, minQuality: MIN_FINGER_QUALITY, acceptable: capture.quality >= MIN_FINGER_QUALITY };
  }

  /** Si hay estación de huellas configurada (no consulta nada; no toca ningún reloj). */
  fingerprintStationInfo(): { configured: boolean; url: string | null } {
    return { configured: this.station !== null, url: this.station?.url ?? null };
  }

  /**
   * Prueba del lector: captura un dedo con la estación y devuelve la calidad. La
   * plantilla se descarta aquí mismo: no se guarda, no se aplica a ningún reloj y no se registra.
   */
  async testFingerprintStation(fingerNo: number) {
    if (!this.station) throw new HttpError(503, "FINGERPRINT_STATION_NOT_CONFIGURED");
    const stationClient = new IsapiClient(this.station.url, this.station.user, this.station.pass);
    const capture = await this.stationCall(() => stationClient.captureFingerPrint(fingerNo));
    return { fingerNo, quality: capture.quality, minQuality: MIN_FINGER_QUALITY, acceptable: capture.quality >= MIN_FINGER_QUALITY };
  }

  /**
   * Paso 2: da de alta la huella capturada y espera a que el equipo la confirme. La
   * captura se consume siempre (con éxito o con error): si falla, hay que capturar de nuevo.
   */
  async applyFingerprint(userId: string, serial: string, captureId: string, actorId: string) {
    const user = await this.userWithNumber(userId);
    const capture = this.pendingCaptures.get(captureId);
    if (!capture || capture.expiresAt < Date.now() || capture.employeeNumber !== user.employeeNumber) {
      throw new HttpError(404, "FINGERPRINT_CAPTURE_NOT_FOUND");
    }
    if (capture.quality < MIN_FINGER_QUALITY) {
      throw new HttpError(422, "FINGERPRINT_QUALITY_LOW", { quality: capture.quality, min: MIN_FINGER_QUALITY });
    }
    // La misma captura sirve para cada reloj donde se aplique (no se consume hasta que caduca).
    const { client } = await this.clockFor(serial, true);
    await this.deviceCall(() =>
      client.fingerprintAdd({ employeeNumber: capture.employeeNumber, fingerPrintID: capture.fingerNo, fingerData: capture.fingerData })
    );
    let applied = false;
    for (let poll = 0; poll < APPLY_POLLS && !applied; poll++) {
      applied = await this.deviceCall(() => client.fingerprintApplied());
      if (!applied) await sleep(APPLY_POLL_MS);
    }
    if (!applied) throw new HttpError(504, "FINGERPRINT_APPLY_TIMEOUT");
    await this.log("TIME_CLOCK_FINGERPRINT_APPLIED", serial, actorId, { employeeNumber: capture.employeeNumber, fingerNo: capture.fingerNo, quality: capture.quality });
    return { applied: true, serial, fingerNo: capture.fingerNo, fingerprints: await this.fingerprintTotal(client, capture.employeeNumber) };
  }

  /** Errores de la estación de huellas con su propio código, para que la web explique qué pasó. */
  private async stationCall<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof IsapiAuthError) throw new HttpError(502, "FINGERPRINT_STATION_AUTH");
      throw new HttpError(502, "FINGERPRINT_STATION_REJECTED", { detail: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Errores del equipo como errores de la API; las credenciales rechazadas se propagan tal cual. */
  private async deviceCall<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (e instanceof HttpError || e instanceof IsapiAuthError) throw e;
      throw new HttpError(502, "TIME_CLOCK_REJECTED", { detail: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Ficha de una persona: tarjetas, huellas (solo metadatos), rostro, vínculo y checadas de hoy. Solo lee. */
  async detail(serial: string, employeeNumber: string) {
    const { client } = await this.clockFor(serial, false);
    const { people, cards } = await this.readAll(client);
    const person = people.find((p) => p.employeeNumber === employeeNumber);
    if (!person) throw new HttpError(404, "TIME_CLOCK_PERSON_NOT_FOUND", { employeeNumber });
    const [faces, fingers] = await Promise.all([client.faceRecords(employeeNumber), client.fingerprints(employeeNumber)]);
    const link = await this.db.timeClockEmployee.findUnique({
      where: { employeeNumber },
      select: { status: true, user: { select: { id: true, name: true, active: true } } },
    });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const punchesToday = await this.db.timeClockPunch.count({
      where: { employeeNumber, occurredAt: { gte: startOfDay } },
    });
    return {
      employeeNumber,
      name: person.name,
      cards: cards.filter((c) => c.employeeNumber === employeeNumber).map((c) => c.cardNo),
      faces: { count: faces.length },
      fingerprints: fingers,
      link: link ? { status: link.status, userId: link.user.id, userName: link.user.name, userActive: link.user.active } : null,
      punchesToday,
    };
  }

  /** Foto del rostro registrado (bytes JPEG). Solo lee. */
  async photo(serial: string, employeeNumber: string): Promise<Buffer> {
    const { client } = await this.clockFor(serial, false);
    const faces = await client.faceRecords(employeeNumber);
    if (faces.length === 0) throw new HttpError(404, "TIME_CLOCK_PHOTO_NOT_FOUND", { employeeNumber });
    return client.photo(faces[0].faceURL);
  }

  async create(serial: string, input: { employeeNumber: string; name: string; gender: string }, actorId: string) {
    const { client } = await this.clockFor(serial, true);
    const { people } = await this.readAll(client);
    if (people.some((p) => p.employeeNumber === input.employeeNumber)) {
      throw new HttpError(409, "TIME_CLOCK_PERSON_EXISTS", { employeeNumber: input.employeeNumber });
    }
    await client.userAdd(input);
    await this.log("TIME_CLOCK_PERSON_CREATED", serial, actorId, { employeeNumber: input.employeeNumber, name: input.name });
    return { employeeNumber: input.employeeNumber };
  }

  async rename(serial: string, employeeNumber: string, input: { name: string }, actorId: string) {
    const { client } = await this.clockFor(serial, true);
    const { people } = await this.readAll(client);
    const before = people.find((p) => p.employeeNumber === employeeNumber);
    if (!before) throw new HttpError(404, "TIME_CLOCK_PERSON_NOT_FOUND", { employeeNumber });
    await client.userModify({ employeeNumber, name: input.name });
    await this.log("TIME_CLOCK_PERSON_UPDATED", serial, actorId, { employeeNumber, before: before.name, after: input.name });
    return { employeeNumber };
  }

  /** Quita primero sus tarjetas y luego a la persona. */
  async remove(serial: string, employeeNumber: string, actorId: string) {
    const { client } = await this.clockFor(serial, true);
    const { people, cards } = await this.readAll(client);
    const person = people.find((p) => p.employeeNumber === employeeNumber);
    if (!person) throw new HttpError(404, "TIME_CLOCK_PERSON_NOT_FOUND", { employeeNumber });
    for (const card of cards.filter((c) => c.employeeNumber === employeeNumber)) {
      await client.cardDelete(card.cardNo);
    }
    await client.userDelete(employeeNumber);
    await this.log("TIME_CLOCK_PERSON_DELETED", serial, actorId, { employeeNumber, name: person.name });
    return { employeeNumber };
  }

  async addCard(serial: string, employeeNumber: string, cardNo: string, actorId: string) {
    const { client } = await this.clockFor(serial, true);
    const { people, cards } = await this.readAll(client);
    if (!people.some((p) => p.employeeNumber === employeeNumber)) {
      throw new HttpError(404, "TIME_CLOCK_PERSON_NOT_FOUND", { employeeNumber });
    }
    if (cards.some((c) => c.cardNo === cardNo)) {
      throw new HttpError(409, "TIME_CLOCK_CARD_EXISTS", { cardNo });
    }
    await client.cardAdd(employeeNumber, cardNo);
    await this.log("TIME_CLOCK_CARD_ADDED", serial, actorId, { employeeNumber, cardNo });
    return { cardNo };
  }

  async removeCard(serial: string, cardNo: string, actorId: string) {
    const { client } = await this.clockFor(serial, true);
    const { cards } = await this.readAll(client);
    const card = cards.find((c) => c.cardNo === cardNo);
    if (!card) throw new HttpError(404, "TIME_CLOCK_CARD_NOT_FOUND", { cardNo });
    await client.cardDelete(cardNo);
    await this.log("TIME_CLOCK_CARD_REMOVED", serial, actorId, { cardNo, employeeNumber: card.employeeNumber });
    return { cardNo };
  }

  private async log(action: string, serial: string, actorId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.audit?.({ action, entityType: "TimeClock", entityId: serial, userId: actorId, metadata });
  }
}
