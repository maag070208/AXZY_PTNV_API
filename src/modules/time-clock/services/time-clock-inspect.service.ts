import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { IsapiClient } from "./isapi.client";
import type { TimeClockCredentials } from "./time-clock.service";

/** Límites para no leer de más en una sola respuesta. */
const MAX_USERS = 1000;
const MAX_CARDS = 1000;
const MAX_EVENTS = 300;
const ANY_EVENT_TYPE = 0;

/**
 * Lo que tiene un reloj registrado: identidad, personas, tarjetas y eventos del
 * propio equipo. SOLO LECTURA: no crea, cambia ni borra nada en el reloj.
 */
export class TimeClockInspectService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly credentials: TimeClockCredentials | null = null
  ) {}

  private async clientFor(serial: string): Promise<{ client: IsapiClient; name: string | null; url: string }> {
    if (!this.credentials) throw new HttpError(503, "TIME_CLOCK_NOT_CONFIGURED");
    const clock = await this.db.timeClock.findUnique({ where: { serialNumber: serial } });
    if (!clock || !clock.url) throw new HttpError(404, "TIME_CLOCK_NOT_FOUND");
    const { user, pass } = this.credentials;
    return { client: new IsapiClient(clock.url, user, pass), name: clock.name, url: clock.url };
  }

  /** Identidad, hora y conteos del equipo. */
  async overview(serial: string) {
    const { client, name, url } = await this.clientFor(serial);
    const [device, time, counts] = await Promise.all([client.deviceInfo(), client.time(), client.userCount()]);
    return {
      clock: { serialNumber: serial, name, url },
      device,
      time: { localTime: time.localTime, timeMode: time.timeMode, timeZone: time.timeZone },
      counts,
    };
  }

  /** Personas dadas de alta en el reloj (hasta `MAX_USERS`). */
  async users(serial: string) {
    const { client } = await this.clientFor(serial);
    const people: Array<{ employeeNumber: string; name: string }> = [];
    let total = 0;
    for await (const page of client.users()) {
      total = page.totalMatches;
      people.push(...page.people);
      if (people.length >= MAX_USERS) break;
    }
    return { total, shown: people.length, people: people.slice(0, MAX_USERS) };
  }

  /** Tarjetas registradas en el reloj (hasta `MAX_CARDS`). */
  async cards(serial: string) {
    const { client } = await this.clientFor(serial);
    const cards: Array<{ cardNo: string; employeeNumber: string; cardType: string | null }> = [];
    let total = 0;
    for await (const page of client.cards()) {
      total = page.totalMatches;
      cards.push(...page.cards);
      if (cards.length >= MAX_CARDS) break;
    }
    return { total, shown: cards.length, cards: cards.slice(0, MAX_CARDS) };
  }

  /**
   * Cámara de la terminal: canales y cómo verla. Solo lee. En un reloj local
   * (el mock) devuelve un video de prueba reproducible en el navegador. En un
   * reloj real el stream es RTSP, que el navegador no reproduce: se informa la
   * ruta SIN credenciales y se requiere un servidor de medios (p. ej. MediaMTX).
   */
  async camera(serial: string) {
    const { client, url } = await this.clientFor(serial);
    const [inputs, streams] = await Promise.all([client.videoChannels(), client.streamingChannels()]);
    const host = new URL(url).hostname;
    const local = host === "127.0.0.1" || host === "localhost";
    const main = streams.find((s) => s.id === "101") ?? streams[0] ?? null;
    return {
      inputs,
      streams,
      playback: local
        ? { mode: "http" as const, url: `${url}/mock/video/camera-test.mp4` }
        : { mode: "none" as const, reason: "rtsp" as const, rtspPath: main ? `rtsp://${host}/Streaming/Channels/${main.id}` : null },
    };
  }

  /** Eventos que el propio equipo guardó en los últimos `days` días (más recientes primero). */
  async events(serial: string, days: number) {
    const { client } = await this.clientFor(serial);
    const from = new Date(Date.now() - days * 86_400_000);
    const events: Array<{ serialNo: number; time: string; minor: number; employeeNumber: string | null; name: string | null }> = [];
    let total = 0;
    for await (const batch of client.acsEventsBetween(from, new Date(), ANY_EVENT_TYPE)) {
      total = batch.totalMatches;
      for (const e of batch.events) {
        events.push({
          serialNo: e.serialNo,
          time: e.time,
          minor: e.minor,
          employeeNumber: e.employeeNoString ?? null,
          name: e.name ?? null,
        });
      }
      if (events.length >= MAX_EVENTS) break;
    }
    events.sort((a, b) => b.serialNo - a.serialNo);
    return { total, shown: Math.min(events.length, MAX_EVENTS), events: events.slice(0, MAX_EVENTS) };
  }
}
