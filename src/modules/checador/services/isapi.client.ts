import { createHash, randomBytes, randomUUID } from "crypto";
import type {
  AcsEventBatch,
  AcsEventPage,
  ChecadorDeviceInfo,
} from "../models/entity/checador.entity";

/** El reloj rechazó usuario/contraseña. */
export class IsapiAuthError extends Error {
  constructor() {
    super("El checador rechazó las credenciales (CHECADOR_USER / CHECADOR_PASS)");
    this.name = "IsapiAuthError";
  }
}

/** Máximo de eventos por página que acepta el equipo. */
const PAGE_SIZE = 30;

/**
 * Tope de consecutivo de la búsqueda. El equipo anuncia 3e9 en sus
 * capacidades, pero con un valor mayor a int32 no devuelve ningún evento.
 */
const MAX_SERIAL_NO = 2_147_483_647;

/**
 * Ventana de tiempo abierta: el filtro real es el consecutivo, así un cambio
 * de hora en el reloj (p. ej. horario de verano) no hace perder eventos.
 */
const ANY_TIME = {
  startTime: "2000-01-01T00:00:00+00:00",
  endTime: "2037-12-31T23:59:59+00:00",
};

/** Instante en el formato de hora ISAPI (`2026-09-24T16:00:00+00:00`); el equipo respeta el offset. */
const isapiTime = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, "+00:00");

type DigestChallenge = Record<string, string>;

const xmlTag = (xml: string, name: string): string | undefined =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();

const parseChallenge = (header: string): DigestChallenge => {
  const params: DigestChallenge = {};
  const pairs = header.replace(/^Digest\s+/i, "").matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g);
  for (const [, key, quoted, bare] of pairs) params[key.toLowerCase()] = quoted ?? bare;
  return params;
};

/** Header `Authorization: Digest …` (RFC 7616, qop=auth, MD5 o SHA-256). */
const digestAuthorization = (
  challenge: DigestChallenge,
  method: string,
  uri: string,
  user: string,
  pass: string
): string => {
  const sha256 = challenge.algorithm?.toUpperCase() === "SHA-256";
  const hash = (value: string): string =>
    createHash(sha256 ? "sha256" : "md5").update(value).digest("hex");
  const qop = challenge.qop?.split(",").map((q) => q.trim()).includes("auth") ? "auth" : undefined;
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const ha1 = hash(`${user}:${challenge.realm}:${pass}`);
  const ha2 = hash(`${method}:${uri}`);
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const fields = [
    `username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) fields.push(`algorithm=${challenge.algorithm}`);
  if (challenge.opaque !== undefined) fields.push(`opaque="${challenge.opaque}"`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${fields.join(", ")}`;
};

/** Mensaje legible de un `ResponseStatus` ISAPI (JSON o XML). */
const describeIsapiError = (body: string): string => {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const parts = [json.statusString, json.subStatusCode, json.errorMsg].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  } catch {
    // No es JSON: se intenta como XML.
  }
  const parts = [xmlTag(body, "statusString"), xmlTag(body, "subStatusCode")].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : body.slice(0, 200);
};

/**
 * Cliente ISAPI del reloj checador Hikvision, de SOLO LECTURA.
 *
 * Regla del negocio: al reloj nunca se le escribe (ni configuración, ni
 * `httpHosts`/push, ni usuarios), solo se lee. Por eso no expone un `request`
 * genérico, solo las dos lecturas que usa la sincronización. La búsqueda de
 * eventos es un POST porque así la define ISAPI, pero es una consulta: no
 * modifica el equipo.
 *
 * Autenticación HTTP Digest sin dependencias: cada petición pide su propio
 * reto. Unas credenciales rechazadas no se reintentan (`IsapiAuthError`), para
 * no disparar el bloqueo por intentos fallidos del equipo.
 */
export class IsapiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly user: string,
    private readonly pass: string,
    // La primera página de cada búsqueda tarda ~6 s en el equipo.
    private readonly timeoutMs = 30_000
  ) {}

  /** Serie y modelo del equipo (`GET /ISAPI/System/deviceInfo`, XML). */
  async deviceInfo(): Promise<ChecadorDeviceInfo> {
    const xml = await this.send("GET", "/ISAPI/System/deviceInfo");
    const serialNumber = xmlTag(xml, "serialNumber");
    if (!serialNumber) throw new Error("El checador no reportó su número de serie");
    return { serialNumber, model: xmlTag(xml, "model") ?? null };
  }

  /**
   * Eventos de acceso con consecutivo entre `fromSerialNo` y `toSerialNo`,
   * página por página. El equipo los entrega en orden de hora, no de
   * consecutivo.
   */
  acsEvents(fromSerialNo: number, toSerialNo = MAX_SERIAL_NO): AsyncGenerator<AcsEventBatch> {
    return this.search({
      ...ANY_TIME,
      beginSerialNo: Math.max(1, fromSerialNo),
      endSerialNo: Math.min(toSerialNo, MAX_SERIAL_NO),
    });
  }

  /** Eventos de acceso ocurridos entre `start` y `end` (inclusive) según el reloj. */
  acsEventsBetween(start: Date, end: Date): AsyncGenerator<AcsEventBatch> {
    return this.search({ startTime: isapiTime(start), endTime: isapiTime(end) });
  }

  /** Búsqueda paginada `AcsEvent` (major 5, todos los subtipos) con el filtro dado. */
  private async *search(filtro: Record<string, string | number>): AsyncGenerator<AcsEventBatch> {
    const searchID = randomUUID();
    let position = 0;
    for (;;) {
      const body = await this.send(
        "POST",
        "/ISAPI/AccessControl/AcsEvent?format=json",
        JSON.stringify({
          AcsEventCond: {
            searchID,
            searchResultPosition: position,
            maxResults: PAGE_SIZE,
            major: 5,
            minor: 0,
            ...filtro,
          },
        })
      );
      const page = this.parseAcsEventPage(body);
      const items = page.InfoList ?? [];
      if (items.length > 0) yield { totalMatches: page.totalMatches, eventos: items };
      position += items.length;
      if (page.responseStatusStrg !== "MORE" || items.length === 0) return;
    }
  }

  private parseAcsEventPage(body: string): AcsEventPage {
    let page: AcsEventPage | undefined;
    try {
      page = (JSON.parse(body) as { AcsEvent?: AcsEventPage }).AcsEvent;
    } catch {
      page = undefined;
    }
    if (!page) throw new Error(`Respuesta inesperada del checador: ${describeIsapiError(body)}`);
    return page;
  }

  private async send(method: "GET" | "POST", path: string, body?: string): Promise<string> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = body ? { "Content-Type": "application/json" } : {};

    let res = await this.request(url, method, headers, body);
    if (res.status === 401) {
      const challenge = res.headers.get("www-authenticate") ?? "";
      await res.body?.cancel();
      if (!/^Digest\s/i.test(challenge)) {
        throw new Error(`El checador no ofreció autenticación Digest (${challenge || "sin reto"})`);
      }
      headers.Authorization = digestAuthorization(
        parseChallenge(challenge),
        method,
        url.pathname + url.search,
        this.user,
        this.pass
      );
      res = await this.request(url, method, headers, body);
      if (res.status === 401) {
        await res.body?.cancel();
        throw new IsapiAuthError();
      }
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`El checador respondió ${res.status} en ${url.pathname}: ${describeIsapiError(text)}`);
    }
    return text;
  }

  private async request(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<Response> {
    try {
      return await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const code = (err as { cause?: { code?: string } }).cause?.code;
      throw new Error(`No se pudo conectar con el checador (${this.baseUrl}): ${reason}${code ? ` [${code}]` : ""}`);
    }
  }
}
