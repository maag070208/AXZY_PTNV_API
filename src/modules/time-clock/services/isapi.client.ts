import { createHash, randomBytes, randomUUID } from "crypto";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "http";
import { request as httpsRequest } from "https";
import type {
  AcsEventBatch,
  AcsEventPage,
  TimeClockUserPage,
  UserInfoSearchPage,
  TimeClockCardPage,
  CardInfoSearchPage,
  TimeClockDeviceInfo,
  TimeClockDeviceTime,
  TimeClockUserCount,
} from "../models/entity/time-clock.entity";

/** El reloj rechazó usuario/contraseña. */
export class IsapiAuthError extends Error {
  constructor() {
    super("The time clock rejected the credentials (TIME_CLOCK_USER / TIME_CLOCK_PASS)");
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

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

/** Busca un número por nombre en cualquier nivel del JSON (la envoltura varía entre firmware). */
const findNumber = (value: unknown, key: string): number | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (key in record && Number.isFinite(Number(record[key]))) return Number(record[key]);
  for (const child of Object.values(record)) {
    const hit = findNumber(child, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

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

interface IsapiResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** Bytes tal cual (fotos incluidas). */
  raw: Buffer;
  body: string;
}

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
 * Cliente ISAPI del reloj checador Hikvision.
 *
 * Regla del negocio: de lectura por defecto. Las operaciones de ESCRITURA
 * (personas y tarjetas) existen solo para `TimeClockPeopleService`, detrás de un
 * candado; nunca se escribe configuración, `httpHosts`/push ni nada más. Por eso no expone un `request`
 * genérico, solo lecturas: identidad, hora y personas del equipo (GET) y la
 * búsqueda de eventos, que es un POST porque así la define ISAPI, pero es una
 * consulta: no modifica el equipo.
 *
 * Autenticación HTTP Digest sin dependencias: cada petición pide su propio
 * reto. Unas credenciales rechazadas no se reintentan (`IsapiAuthError`), para
 * no disparar el bloqueo por intentos fallidos del equipo.
 *
 * Acepta `http://` y `https://`. Con https los relojes presentan un certificado
 * autofirmado (`CN=tmp_comm.cert`) que no se puede verificar: la conexión va
 * cifrada, pero sin validar la identidad del equipo.
 */
export class IsapiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly user: string,
    private readonly pass: string,
    // La primera página de cada búsqueda tarda ~6 s en el equipo.
    private readonly timeoutMs = 30_000
  ) {}

  /** Identidad del equipo (`GET /ISAPI/System/deviceInfo`, XML). */
  async deviceInfo(): Promise<TimeClockDeviceInfo> {
    const xml = await this.send("GET", "/ISAPI/System/deviceInfo");
    const serialNumber = xmlTag(xml, "serialNumber");
    if (!serialNumber) throw new Error("The time clock did not report its serial number");
    return {
      serialNumber,
      model: xmlTag(xml, "model") ?? null,
      deviceName: xmlTag(xml, "deviceName") || null,
      firmwareVersion: xmlTag(xml, "firmwareVersion") || null,
      macAddress: xmlTag(xml, "macAddress") || null,
    };
  }

  /** Hora del equipo (`GET /ISAPI/System/time`, XML). */
  async time(): Promise<TimeClockDeviceTime> {
    const xml = await this.send("GET", "/ISAPI/System/time");
    const localTime = xmlTag(xml, "localTime");
    const instant = localTime ? new Date(localTime) : null;
    if (!localTime || !instant || Number.isNaN(instant.getTime())) {
      throw new Error("The time clock did not report its time");
    }
    return {
      localTime,
      instant,
      timeMode: xmlTag(xml, "timeMode") || null,
      timeZone: xmlTag(xml, "timeZone") || null,
    };
  }

  /** Personas dadas de alta (`GET /ISAPI/AccessControl/UserInfo/Count?format=json`). */
  async userCount(): Promise<TimeClockUserCount> {
    const body = await this.send("GET", "/ISAPI/AccessControl/UserInfo/Count?format=json");
    let count: Partial<TimeClockUserCount> | undefined;
    try {
      count = (JSON.parse(body) as { UserInfoCount?: Partial<TimeClockUserCount> }).UserInfoCount;
    } catch {
      count = undefined;
    }
    if (typeof count?.userNumber !== "number") {
      throw new Error(`Unexpected response from the time clock: ${describeIsapiError(body)}`);
    }
    return {
      userNumber: count.userNumber,
      bindFaceUserNumber: count.bindFaceUserNumber ?? 0,
      bindFingerprintUserNumber: count.bindFingerprintUserNumber ?? 0,
      bindCardUserNumber: count.bindCardUserNumber ?? 0,
    };
  }

  /**
   * Personas dadas de alta en el reloj (`POST /ISAPI/AccessControl/UserInfo/Search`,
   * página por página). Es una búsqueda, igual que `AcsEvent`: no modifica nada.
   * Forma de la petición y de la respuesta: por confirmar con el probe (ver
   * TIME_CLOCK_SYNC.md §2 y §8).
   */
  async *users(): AsyncGenerator<TimeClockUserPage> {
    const searchID = randomUUID();
    let position = 0;
    for (;;) {
      const body = await this.send(
        "POST",
        "/ISAPI/AccessControl/UserInfo/Search?format=json",
        JSON.stringify({
          UserInfoSearchCond: {
            searchID,
            searchResultPosition: position,
            maxResults: PAGE_SIZE,
          },
        })
      );
      const page = this.parseUserPage(body);
      position += page.people.length;
      yield page;
      if (page.responseStatusStrg !== "MORE" || page.people.length === 0) return;
    }
  }

  /**
   * Tarjetas registradas en el reloj (`POST /ISAPI/AccessControl/CardInfo/Search`),
   * página por página. Solo lee.
   */
  async *cards(): AsyncGenerator<TimeClockCardPage> {
    const searchID = randomUUID();
    let position = 0;
    for (;;) {
      const body = await this.send(
        "POST",
        "/ISAPI/AccessControl/CardInfo/Search?format=json",
        JSON.stringify({
          CardInfoSearchCond: { searchID, searchResultPosition: position, maxResults: PAGE_SIZE },
        })
      );
      const page = this.parseCardPage(body);
      position += page.cards.length;
      yield page;
      if (page.responseStatusStrg !== "MORE" || page.cards.length === 0) return;
    }
  }

  /** Canales de video de la terminal (`GET /ISAPI/System/Video/inputs/channels`, XML). Solo lee. */
  async videoChannels(): Promise<Array<{ id: string; name: string | null; enabled: boolean }>> {
    const xml = await this.send("GET", "/ISAPI/System/Video/inputs/channels");
    const blocks = xml.match(/<VideoInputChannel>[\s\S]*?<\/VideoInputChannel>/g) ?? [];
    return blocks.map((b) => ({
      id: xmlTag(b, "id") ?? "",
      name: xmlTag(b, "name") || null,
      enabled: xmlTag(b, "videoInputEnabled") === "true",
    }));
  }

  /** Canales de transmisión (`GET /ISAPI/Streaming/channels`, XML). Solo lee. */
  async streamingChannels(): Promise<Array<{ id: string; name: string | null; enabled: boolean; transport: string | null; width: number | null; height: number | null }>> {
    const xml = await this.send("GET", "/ISAPI/Streaming/channels");
    const blocks = xml.match(/<StreamingChannel[ >][\s\S]*?<\/StreamingChannel>/g) ?? [];
    return blocks.map((b) => ({
      id: xmlTag(b, "id") ?? "",
      name: xmlTag(b, "channelName") || null,
      enabled: xmlTag(b, "enabled") === "true",
      transport: xmlTag(b, "streamingTransport") || null,
      width: Number(xmlTag(b, "videoResolutionWidth")) || null,
      height: Number(xmlTag(b, "videoResolutionHeight")) || null,
    }));
  }

  /** Rostros registrados de una persona (`POST FDLib/FDSearch`, consulta). Solo metadatos y la URL de la foto. */
  async faceRecords(employeeNumber: string): Promise<Array<{ faceURL: string }>> {
    const body = await this.send(
      "POST",
      "/ISAPI/Intelligent/FDLib/FDSearch?format=json",
      JSON.stringify({ searchResultPosition: 0, maxResults: 100, faceLibType: "blackFD", FDID: "1", FPID: employeeNumber })
    );
    let search: { MatchList?: Array<{ faceURL?: string }> } | undefined;
    try {
      search = JSON.parse(body) as typeof search;
    } catch {
      search = undefined;
    }
    return (search?.MatchList ?? []).map((m) => ({ faceURL: String(m.faceURL ?? "") })).filter((m) => m.faceURL !== "");
  }

  /**
   * Huellas registradas de una persona (`POST AccessControl/FingerPrintUpload`,
   * consulta por dedo). Devuelve solo metadatos: nunca las plantillas.
   */
  async fingerprints(employeeNumber: string, maxFingers = 10): Promise<Array<{ fingerPrintID: number; fingerType: string | null }>> {
    const found: Array<{ fingerPrintID: number; fingerType: string | null }> = [];
    for (let id = 1; id <= maxFingers; id++) {
      const body = await this.send(
        "POST",
        "/ISAPI/AccessControl/FingerPrintUpload?format=json",
        JSON.stringify({ FingerPrintCond: { searchID: "0", employeeNo: employeeNumber, fingerPrintID: id } })
      );
      let info: { FingerPrintInfo?: { FingerPrintList?: Array<{ fingerPrintID?: number; fingerType?: string }> } } | undefined;
      try {
        info = JSON.parse(body) as typeof info;
      } catch {
        info = undefined;
      }
      for (const f of info?.FingerPrintInfo?.FingerPrintList ?? []) {
        found.push({ fingerPrintID: Number(f.fingerPrintID ?? id), fingerType: f.fingerType ?? null });
      }
    }
    return found;
  }

  /**
   * Número de huellas de una persona con una sola consulta (`GET FingerPrint/Count`).
   * Devuelve `null` si el equipo no lo soporta (respuesta 4xx distinta de 401), para
   * que quien llama use el recorrido por dedos. Las credenciales rechazadas y los
   * fallos de conexión se propagan: no se reintentan ni se ocultan.
   */
  async fingerprintCount(employeeNumber: string): Promise<number | null> {
    let body: string;
    try {
      body = await this.send("GET", `/ISAPI/AccessControl/FingerPrint/Count?format=json&employeeNo=${encodeURIComponent(employeeNumber)}`);
    } catch (e) {
      if (e instanceof Error && /^The time clock answered 4\d\d /.test(e.message)) return null;
      throw e;
    }
    const found = findNumber(safeJson(body), "numberOfFP");
    return found === undefined ? null : found;
  }

  /**
   * Captura una huella con el sensor del equipo (`POST CaptureFingerPrint`, XML). Es una
   * ACCIÓN sobre el reloj (enciende el sensor y espera un dedo): solo se usa en relojes
   * con escritura permitida. Devuelve la plantilla (base64, ≤768 caracteres) y su calidad.
   */
  async captureFingerPrint(fingerNo: number): Promise<{ fingerData: string; fingerNo: number; quality: number }> {
    const body = await this.send(
      "POST",
      "/ISAPI/AccessControl/CaptureFingerPrint",
      `<CaptureFingerPrintCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerNo>${fingerNo}</fingerNo></CaptureFingerPrintCond>`,
      "application/xml"
    );
    const fingerData = xmlTag(body, "fingerData");
    const quality = Number(xmlTag(body, "fingerPrintQuality"));
    if (!fingerData || !Number.isFinite(quality)) {
      throw new Error(`Unexpected response from the time clock: ${describeIsapiError(body)}`);
    }
    return { fingerData, fingerNo: Number(xmlTag(body, "fingerNo") ?? fingerNo), quality };
  }

  /** Empieza el alta de una huella (`POST FingerPrintDownload`). Es asíncrona: se confirma con `fingerprintApplied`. */
  async fingerprintAdd(input: { employeeNumber: string; fingerPrintID: number; fingerData: string }): Promise<void> {
    await this.writeOk("POST", "/ISAPI/AccessControl/FingerPrintDownload?format=json", {
      FingerPrintCfg: {
        employeeNo: input.employeeNumber,
        enableCardReader: [1],
        fingerPrintID: input.fingerPrintID,
        fingerType: "normalFP",
        fingerData: input.fingerData,
      },
    });
  }

  /** ¿Terminó el alta de huella en curso? (`GET FingerPrintProgress`: `totalStatus` 1 = terminó). */
  async fingerprintApplied(): Promise<boolean> {
    const body = await this.send("GET", "/ISAPI/AccessControl/FingerPrintProgress?format=json");
    return findNumber(safeJson(body), "totalStatus") === 1;
  }

  /** Bytes de una foto del equipo (GET con Digest). Solo lee. */
  async photo(absoluteUrl: string): Promise<Buffer> {
    const res = await this.exchange("GET", new URL(absoluteUrl));
    return res.raw;
  }

  // ── ESCRITURA ─────────────────────────────────────────────────────────
  // Solo las usa `TimeClockPeopleService`, que aplica el candado (solo el mock
  // o un reloj con TIME_CLOCK_WRITE_ENABLED). Cada operación confirma el
  // `statusCode` del equipo: si no es OK, lanza error con su motivo.

  /** Da de alta una persona (`POST UserInfo/Record`). */
  async userAdd(person: { employeeNumber: string; name: string; gender: string }): Promise<void> {
    await this.writeOk("POST", "/ISAPI/AccessControl/UserInfo/Record?format=json", {
      UserInfo: {
        employeeNo: person.employeeNumber,
        name: person.name,
        userType: "normal",
        gender: person.gender,
        Valid: { enable: true, beginTime: "2020-01-01T00:00:00", endTime: "2036-12-31T23:59:59", timeType: "local" },
        doorRight: "1",
        RightPlan: [{ doorNo: 1, planTemplateNo: "1" }],
        localUIRight: false,
        userVerifyMode: "",
      },
    });
  }

  /** Cambia el nombre de una persona (`PUT UserInfo/Modify`). */
  async userModify(person: { employeeNumber: string; name: string }): Promise<void> {
    await this.writeOk("PUT", "/ISAPI/AccessControl/UserInfo/Modify?format=json", {
      UserInfo: { employeeNo: person.employeeNumber, name: person.name, userType: "normal" },
    });
  }

  /** Da de baja una persona del reloj (`PUT UserInfo/Delete`). */
  async userDelete(employeeNumber: string): Promise<void> {
    await this.writeOk("PUT", "/ISAPI/AccessControl/UserInfo/Delete?format=json", {
      UserInfoDelCond: { EmployeeNoList: [{ employeeNo: employeeNumber }] },
    });
  }

  /** Registra una tarjeta a una persona (`PUT CardInfo/SetUp`). */
  async cardAdd(employeeNumber: string, cardNo: string): Promise<void> {
    await this.writeOk("PUT", "/ISAPI/AccessControl/CardInfo/SetUp?format=json", {
      CardInfo: { employeeNo: employeeNumber, cardNo, cardType: "normalCard", checkCardNo: true, checkEmployeeNo: true },
    });
  }

  /** Quita una tarjeta (`PUT CardInfo/Delete`). */
  async cardDelete(cardNo: string): Promise<void> {
    await this.writeOk("PUT", "/ISAPI/AccessControl/CardInfo/Delete?format=json", {
      CardInfoDelCond: { CardNoList: [{ cardNo }] },
    });
  }

  private async writeOk(method: "POST" | "PUT", path: string, payload: unknown): Promise<void> {
    const body = await this.send(method, path, JSON.stringify(payload));
    let status: { statusCode?: number | string; statusString?: string } | undefined;
    try {
      status = JSON.parse(body) as typeof status;
    } catch {
      status = undefined;
    }
    const code = Number(status?.statusCode);
    if (code !== 1 && status?.statusString !== "OK") {
      throw new Error(`The time clock rejected the operation: ${describeIsapiError(body)}`);
    }
  }

  private parseCardPage(body: string): TimeClockCardPage {
    let search: CardInfoSearchPage | undefined;
    try {
      search = (JSON.parse(body) as { CardInfoSearch?: CardInfoSearchPage }).CardInfoSearch;
    } catch {
      search = undefined;
    }
    if (typeof search?.totalMatches !== "number") {
      throw new Error(`Unexpected response from the time clock: ${describeIsapiError(body)}`);
    }
    const cards = (Array.isArray(search.CardInfo) ? search.CardInfo : [])
      .map((c) => ({
        cardNo: String(c.cardNo ?? "").trim(),
        employeeNumber: String(c.employeeNo ?? "").trim(),
        cardType: String(c.cardType ?? "").trim() || null,
      }))
      .filter((c) => c.cardNo !== "");
    return { totalMatches: search.totalMatches, responseStatusStrg: search.responseStatusStrg, cards };
  }

  private parseUserPage(body: string): TimeClockUserPage {
    let search: UserInfoSearchPage | undefined;
    try {
      search = (JSON.parse(body) as { UserInfoSearch?: UserInfoSearchPage }).UserInfoSearch;
    } catch {
      search = undefined;
    }
    if (typeof search?.totalMatches !== "number") {
      throw new Error(`Unexpected response from the time clock: ${describeIsapiError(body)}`);
    }
    const people = (Array.isArray(search.UserInfo) ? search.UserInfo : [])
      .map((u) => ({ employeeNumber: String(u.employeeNo ?? "").trim(), name: String(u.name ?? "").trim() }))
      .filter((p) => p.employeeNumber !== "");
    return { totalMatches: search.totalMatches, responseStatusStrg: search.responseStatusStrg, people };
  }

  /**
   * Cota de consecutivos desde `fromSerialNo`: el mayor consecutivo que ya
   * existe con seguridad en el reloj, o `null` si no hay eventos. Toda checada
   * con consecutivo menor o igual ya está en el equipo, así que leer hasta ahí
   * deja un cursor exacto. Se toma lo mejor de dos cotas seguras: el evento más
   * reciente por hora y `desde + total − 1` (los consecutivos no se repiten),
   * que no depende de la hora del reloj.
   */
  async lastSerialNo(fromSerialNo: number): Promise<number | null> {
    const from = Math.max(1, fromSerialNo);
    const body = await this.send(
      "POST",
      "/ISAPI/AccessControl/AcsEvent?format=json",
      JSON.stringify({
        AcsEventCond: {
          searchID: randomUUID(),
          searchResultPosition: 0,
          maxResults: 1,
          major: 5,
          minor: 0,
          ...ANY_TIME,
          beginSerialNo: from,
          endSerialNo: MAX_SERIAL_NO,
          timeReverseOrder: true,
          picEnable: false,
        },
      })
    );
    const page = this.parseAcsEventPage(body);
    if (!page.totalMatches) return null;
    return Math.max(from + page.totalMatches - 1, page.InfoList?.[0]?.serialNo ?? 0);
  }

  /**
   * Eventos de un subtipo (`minor`) con consecutivo entre `fromSerialNo` y
   * `toSerialNo`, página por página. El equipo los entrega en orden de hora, no
   * de consecutivo.
   */
  acsEvents(fromSerialNo: number, toSerialNo: number, minor: number): AsyncGenerator<AcsEventBatch> {
    return this.search({
      ...ANY_TIME,
      minor,
      beginSerialNo: Math.max(1, fromSerialNo),
      endSerialNo: Math.min(toSerialNo, MAX_SERIAL_NO),
    });
  }

  /** Eventos de un subtipo (`minor`) ocurridos entre `start` y `end` (inclusive) según el reloj. */
  acsEventsBetween(start: Date, end: Date, minor: number): AsyncGenerator<AcsEventBatch> {
    return this.search({ startTime: isapiTime(start), endTime: isapiTime(end), minor });
  }

  /** Búsqueda paginada `AcsEvent` (major 5, sin fotos) con el filtro dado. */
  private async *search(filter: Record<string, string | number>): AsyncGenerator<AcsEventBatch> {
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
            picEnable: false,
            ...filter,
          },
        })
      );
      const page = this.parseAcsEventPage(body);
      const items = page.InfoList ?? [];
      if (items.length > 0) yield { totalMatches: page.totalMatches, events: items };
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
    if (!page) throw new Error(`Unexpected response from the time clock: ${describeIsapiError(body)}`);
    return page;
  }

  private async send(method: "GET" | "POST" | "PUT", path: string, body?: string, contentType?: string): Promise<string> {
    return (await this.exchange(method, new URL(path, this.baseUrl), body, contentType)).body;
  }

  /** Petición con Digest; devuelve la respuesta completa (bytes incluidos). */
  private async exchange(method: "GET" | "POST" | "PUT", url: URL, body?: string, contentType?: string): Promise<IsapiResponse> {
    const headers: Record<string, string> = body ? { "Content-Type": contentType ?? "application/json" } : {};

    let res = await this.request(url, method, headers, body);
    if (res.status === 401) {
      const challenge = String(res.headers["www-authenticate"] ?? "");
      if (!/^Digest\s/i.test(challenge)) {
        throw new Error(`The time clock did not offer Digest authentication (${challenge || "no challenge"})`);
      }
      headers.Authorization = digestAuthorization(
        parseChallenge(challenge),
        method,
        url.pathname + url.search,
        this.user,
        this.pass
      );
      res = await this.request(url, method, headers, body);
      if (res.status === 401) throw new IsapiAuthError();
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`The time clock answered ${res.status} on ${url.pathname}: ${describeIsapiError(res.body)}`);
    }
    return res;
  }

  /**
   * Una petición HTTP(S) con `http`/`https` de Node en vez de `fetch`, porque
   * `fetch` no permite aceptar el certificado autofirmado del reloj. Los
   * agentes globales de Node ya reutilizan la conexión (keep-alive) y cierran
   * las ociosas a los 5 s.
   */
  private request(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<IsapiResponse> {
    return new Promise((resolve, reject) => {
      const failure = (err: Error): void => {
        const code = (err as NodeJS.ErrnoException).code;
        const item = code && !err.message.includes(code) ? `${err.message} [${code}]` : err.message;
        reject(new Error(`Could not connect to the time clock (${this.baseUrl}): ${item}`));
      };
      const onResponse = (res: IncomingMessage): void => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, body: raw.toString("utf8") });
        });
        res.on("error", failure);
      };
      const options = {
        method,
        headers: body ? { ...headers, "Content-Length": String(Buffer.byteLength(body)) } : headers,
        timeout: this.timeoutMs,
      };
      const req =
        url.protocol === "https:"
          ? httpsRequest(url, { ...options, rejectUnauthorized: false }, onResponse)
          : httpRequest(url, options, onResponse);
      req.on("timeout", () => req.destroy(new Error(`no response in ${this.timeoutMs / 1000} s`)));
      req.on("error", failure);
      req.end(body);
    });
  }
}
