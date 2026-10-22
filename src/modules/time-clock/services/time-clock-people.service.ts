import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiClient } from "./isapi.client";
import type { TimeClockCredentials } from "./time-clock.service";

const MAX_PEOPLE = 1000;
const MAX_CARDS = 1000;
/** Las huellas y rostros se leen persona por persona: se guarda el resultado un rato. */
const BIOMETRICS_TTL_MS = 10 * 60 * 1000;
const BIOMETRICS_CONCURRENCY = 6;

export interface PersonBiometrics {
  faces: number;
  fingerprints: number;
}

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
    private readonly allowWrites = false
  ) {}

  private readonly biometricsCache = new Map<string, { at: number; byEmployee: Record<string, PersonBiometrics> }>();

  private async clockFor(serial: string, write: boolean): Promise<{ client: IsapiClient; name: string | null }> {
    if (!this.credentials) throw new HttpError(503, "TIME_CLOCK_NOT_CONFIGURED");
    const clock = await this.db.timeClock.findUnique({ where: { serialNumber: serial } });
    if (!clock || !clock.url) throw new HttpError(404, "TIME_CLOCK_NOT_FOUND");
    if (write && !this.canWrite(clock.url)) throw new HttpError(403, "TIME_CLOCK_READ_ONLY");
    const { user, pass } = this.credentials;
    return { client: new IsapiClient(clock.url, user, pass), name: clock.name };
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
    return {
      people: people.map((p) => ({
        employeeNumber: p.employeeNumber,
        name: p.name,
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
    const worker = async () => {
      while (next < people.length) {
        const person = people[next++];
        const [faces, fingers] = await Promise.all([
          client.faceRecords(person.employeeNumber),
          client.fingerprints(person.employeeNumber),
        ]);
        byEmployee[person.employeeNumber] = { faces: faces.length, fingerprints: fingers.length };
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
    const rows = [];
    for (const clock of clocks) {
      const canAlta = !!clock.url && this.canWrite(clock.url);
      try {
        const { client } = await this.clockFor(clock.serialNumber, false);
        const { people } = await this.readAll(client);
        const present = !!user.employeeNumber && people.some((p) => p.employeeNumber === user.employeeNumber);
        rows.push({ serial: clock.serialNumber, name: clock.name, connection: "ONLINE" as const, state: present ? ("DADA_DE_ALTA" as const) : ("SIN_ALTA" as const), canAlta });
      } catch {
        rows.push({ serial: clock.serialNumber, name: clock.name, connection: "NO_RESPONSE" as const, state: null, canAlta });
      }
    }
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
      if (!clock.canAlta || clock.connection !== "ONLINE" || clock.state !== "SIN_ALTA") continue;
      try {
        await this.employeeClockAlta(userId, clock.serial, actorId);
        results.push({ serial: clock.serial, name: clock.name ?? clock.serial, ok: true });
      } catch (e) {
        results.push({ serial: clock.serial, name: clock.name ?? clock.serial, ok: false, code: e instanceof HttpError ? e.code : "UNKNOWN" });
      }
    }
    return { results };
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
