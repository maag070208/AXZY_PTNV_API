/**
 * Mock local de un reloj Hikvision (ISAPI), SOLO PARA PRUEBAS.
 *
 * Imita las peticiones que usa el sistema, en memoria, sin tocar ningún reloj
 * real. Escucha solo en 127.0.0.1 y pide HTTP Digest con el usuario y la
 * contraseña de MOCK_USER / MOCK_PASS (por defecto `mock` / `mock-pass-123`).
 *
 *   npx ts-node scripts/isapi-mock/server.ts
 *   GET  /__mock__/state   → personas, tarjetas y conteos (sin contraseñas)
 *   POST /__mock__/reset   → vuelve al estado inicial
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import { join } from "path";

const PORT = Number(process.env.MOCK_PORT ?? 4801);
const HOST = "127.0.0.1";
const USER = process.env.MOCK_USER ?? "mock";
const PASS = process.env.MOCK_PASS ?? "mock-pass-123";
const SERIAL = "MOCK-SERIAL-0001";
const MAX_PERSONS = 300;
const MAX_CARDS = 300;
const PAGE = 30;

interface Person {
  employeeNo: string;
  name: string;
  gender: string;
  userType: string;
  cards: string[];
}
interface Card {
  cardNo: string;
  employeeNo: string;
  cardType: string;
}
interface Event {
  serialNo: number;
  time: string;
  minor: number;
  employeeNoString?: string;
  name?: string;
}

const NAMES = [
  "PERSONA PRUEBA UNO", "PERSONA PRUEBA DOS", "PERSONA PRUEBA TRES", "PERSONA PRUEBA CUATRO",
  "PERSONA PRUEBA CINCO", "PERSONA PRUEBA SEIS", "PERSONA PRUEBA SIETE", "PERSONA PRUEBA OCHO",
];

let persons = new Map<string, Person>();
let cards = new Map<string, Card>();
let events: Event[] = [];
let nonces = new Map<string, number>();

const isoLocal = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-06:00`;
};

const reset = (): void => {
  persons = new Map();
  cards = new Map();
  NAMES.forEach((name, i) => {
    const employeeNo = String(1000 + i);
    persons.set(employeeNo, { employeeNo, name, gender: "male", userType: "normal", cards: [] });
  });
  // Una tarjeta para la primera persona, para probar borrados en cascada.
  cards.set("9000000001", { cardNo: "9000000001", employeeNo: "1000", cardType: "normalCard" });
  persons.get("1000")!.cards.push("9000000001");

  // Eventos de los últimos 3 días, con consecutivos crecientes.
  events = [];
  const now = Date.now();
  let serialNo = 1;
  for (let day = 3; day >= 0; day--) {
    for (let k = 0; k < 12; k++) {
      const when = new Date(now - day * 86_400_000 - (12 - k) * 1_800_000);
      const p = [...persons.values()][(serialNo * 7) % persons.size];
      events.push({
        serialNo: serialNo++,
        time: isoLocal(when),
        minor: k % 5 === 0 ? 104 : k % 2 === 0 ? 75 : 38,
        employeeNoString: k % 5 === 0 ? undefined : p.employeeNo,
        name: k % 5 === 0 ? undefined : p.name,
      });
    }
  }
  nonces = new Map();
};

const md5 = (v: string): string => createHash("md5").update(v).digest("hex");

const challenge = (): { header: string } => {
  const nonce = randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now());
  return {
    header: `Digest realm="mock-isapi", qop="auth", algorithm=MD5, nonce="${nonce}", opaque="${randomBytes(8).toString("hex")}"`,
  };
};

/** Verifica una cabecera `Authorization: Digest …` contra el usuario y contraseña del mock. */
const authorized = (req: IncomingMessage): boolean => {
  const h = String(req.headers.authorization ?? "");
  if (!/^Digest\s/i.test(h)) return false;
  const f: Record<string, string> = {};
  for (const [, k, q, b] of h.replace(/^Digest\s+/i, "").matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    f[k.toLowerCase()] = q ?? b;
  }
  if (f.username !== USER || !nonces.has(f.nonce)) return false;
  if (Date.now() - (nonces.get(f.nonce) ?? 0) > 5 * 60_000) return false;
  const ha1 = md5(`${USER}:mock-isapi:${PASS}`);
  const ha2 = md5(`${req.method}:${f.uri}`);
  const expected = f.qop
    ? md5(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${ha2}`)
    : md5(`${ha1}:${f.nonce}:${ha2}`);
  return expected === f.response;
};

const send = (res: ServerResponse, status: number, body: string, type = "application/json"): void => {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
};
const json = (res: ServerResponse, status: number, obj: unknown): void =>
  send(res, status, JSON.stringify(obj));
const ok = (res: ServerResponse): void => json(res, 200, { statusCode: 1, statusString: "OK" });
const fail = (res: ServerResponse, sub: string, code = 400): void =>
  json(res, code, { statusCode: 4, statusString: "Invalid Operation", subStatusCode: sub, errorMsg: sub });

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString("utf8")));
    req.on("end", () => resolve(data));
  });

const parse = (body: string): Record<string, any> => {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
};

const personView = (p: Person) => ({
  employeeNo: p.employeeNo,
  name: p.name,
  userType: p.userType,
  gender: p.gender,
  password: "", // el equipo real lo devuelve; el mock no guarda contraseñas
  Valid: { enable: true, beginTime: "2026-01-01T00:00:00", endTime: "2036-12-31T23:59:59", timeType: "local" },
  numOfCard: p.cards.length,
});

const page = <T>(items: T[], position: number, max: number) => {
  const slice = items.slice(position, position + Math.min(max || PAGE, PAGE));
  const more = position + slice.length < items.length;
  return { slice, more, total: items.length };
};

const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const body = await readBody(req);

  // Video de prueba de la "cámara" (solo localhost, sin autenticación, con Range).
  if (path === "/mock/video/camera-test.mp4" && (method === "GET" || method === "HEAD")) {
    const file = join(__dirname, "assets", "camera-test.mp4");
    if (!existsSync(file)) return send(res, 404, "missing video");
    const size = statSync(file).size;
    const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ""));
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      if (method === "HEAD") return void res.end();
      return void createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": size });
    if (method === "HEAD") return void res.end();
    return void createReadStream(file).pipe(res);
  }

  // Controles del mock (solo localhost): sin autenticación.
  if (path === "/__mock__/reset" && method === "POST") {
    reset();
    return json(res, 200, { ok: true });
  }
  if (path === "/__mock__/state" && method === "GET") {
    return json(res, 200, {
      serial: SERIAL,
      persons: persons.size,
      cards: cards.size,
      events: events.length,
      personList: [...persons.values()].map((p) => ({ employeeNo: p.employeeNo, name: p.name, cards: p.cards })),
    });
  }

  if (!authorized(req)) {
    const c = challenge();
    res.writeHead(401, { "WWW-Authenticate": c.header, "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return;
  }
  console.log(`[mock] ${method} ${path}`);

  // ── Identidad y hora (XML) ───────────────────────────────────────────
  if (path === "/ISAPI/System/deviceInfo" && method === "GET") {
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><DeviceInfo><deviceName>Mock Access Controller</deviceName><model>DS-K1T-MOCK</model><serialNumber>${SERIAL}</serialNumber><macAddress>00:00:00:00:00:01</macAddress><firmwareVersion>V-MOCK</firmwareVersion></DeviceInfo>`,
      "application/xml"
    );
  }
  if (path === "/ISAPI/System/time" && method === "GET") {
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><Time><timeMode>manual</timeMode><localTime>${isoLocal(new Date())}</localTime><timeZone>CST+6:00:00</timeZone></Time>`,
      "application/xml"
    );
  }

  // ── Video (cámara de la terminal) ──────────────────────────────────
  if (path === "/ISAPI/System/Video/inputs/channels" && method === "GET") {
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><VideoInputChannelList version="2.0"><VideoInputChannel><id>1</id><inputPort>1</inputPort><videoInputEnabled>true</videoInputEnabled><name>MOCK-CAM</name><videoFormat>PAL</videoFormat></VideoInputChannel></VideoInputChannelList>`,
      "application/xml"
    );
  }
  if (path === "/ISAPI/Streaming/channels" && method === "GET") {
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><StreamingChannelList version="2.0"><StreamingChannel><id>101</id><channelName>MOCK-CAM</channelName><enabled>true</enabled><Transport><ControlProtocolList><ControlProtocol><streamingTransport>RTSP</streamingTransport></ControlProtocol></ControlProtocolList></Transport><Video><enabled>true</enabled><videoInputChannelID>1</videoInputChannelID><videoCodecType>H.264</videoCodecType><videoResolutionWidth>640</videoResolutionWidth><videoResolutionHeight>360</videoResolutionHeight></Video></StreamingChannel></StreamingChannelList>`,
      "application/xml"
    );
  }

  // ── Personas ────────────────────────────────────────────────────────
  if (path === "/ISAPI/AccessControl/UserInfo/capabilities" && method === "GET") {
    return json(res, 200, { UserInfo: { maxRecordNum: MAX_PERSONS, supportFunction: "get,post,put,delete" } });
  }
  if (path === "/ISAPI/AccessControl/UserInfo/Count" && method === "GET") {
    const bindCard = [...persons.values()].filter((p) => p.cards.length > 0).length;
    return json(res, 200, {
      UserInfoCount: { userNumber: persons.size, bindFaceUserNumber: 0, bindFingerprintUserNumber: 0, bindCardUserNumber: bindCard },
    });
  }
  if (path === "/ISAPI/AccessControl/UserInfo/Search" && method === "POST") {
    const cond = parse(body).UserInfoSearchCond ?? {};
    const all = [...persons.values()].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
    const pg = page(all, Number(cond.searchResultPosition ?? 0), Number(cond.maxResults ?? PAGE));
    return json(res, 200, {
      UserInfoSearch: {
        searchID: cond.searchID ?? randomUUID(),
        responseStatusStrg: pg.more ? "MORE" : "OK",
        numOfMatches: pg.slice.length,
        totalMatches: pg.total,
        UserInfo: pg.slice.map(personView),
      },
    });
  }
  if (path === "/ISAPI/AccessControl/UserInfo/Record" && method === "POST") {
    const info = parse(body).UserInfo;
    if (!info?.employeeNo) return fail(res, "employeeNoNotExist");
    if (persons.has(String(info.employeeNo))) return fail(res, "employeeNoAlreadyExist");
    if (persons.size >= MAX_PERSONS) return fail(res, "noEnoughMemory");
    persons.set(String(info.employeeNo), {
      employeeNo: String(info.employeeNo),
      name: String(info.name ?? ""),
      gender: info.gender ?? "unknown",
      userType: info.userType ?? "normal",
      cards: [],
    });
    return ok(res);
  }
  if (path === "/ISAPI/AccessControl/UserInfo/Modify" && method === "PUT") {
    const info = parse(body).UserInfo;
    const p = persons.get(String(info?.employeeNo));
    if (!p) return fail(res, "employeeNoNotExist");
    if (info.name !== undefined) p.name = String(info.name);
    if (info.userType !== undefined) p.userType = String(info.userType);
    return ok(res);
  }
  if (path === "/ISAPI/AccessControl/UserInfo/Delete" && method === "PUT") {
    const list: Array<{ employeeNo: string }> = parse(body).UserInfoDelCond?.EmployeeNoList ?? [];
    for (const { employeeNo } of list) {
      const p = persons.get(String(employeeNo));
      if (!p) continue;
      p.cards.forEach((c) => cards.delete(c));
      persons.delete(String(employeeNo));
    }
    return ok(res);
  }

  // ── Tarjetas ────────────────────────────────────────────────────────
  if (path === "/ISAPI/AccessControl/CardInfo/capabilities" && method === "GET") {
    return json(res, 200, { CardInfo: { maxRecordNum: MAX_CARDS, supportFunction: "get,post,put,delete" } });
  }
  if (path === "/ISAPI/AccessControl/CardInfo/Count" && method === "GET") {
    return json(res, 200, { CardInfoCount: { cardNumber: cards.size } });
  }
  if (path === "/ISAPI/AccessControl/CardInfo/Search" && method === "POST") {
    const cond = parse(body).CardInfoSearchCond ?? {};
    const emp: string[] = (cond.EmployeeNoList ?? []).map((e: { employeeNo: string }) => e.employeeNo);
    const all = [...cards.values()].filter((c) => emp.length === 0 || emp.includes(c.employeeNo));
    const pg = page(all, Number(cond.searchResultPosition ?? 0), Number(cond.maxResults ?? PAGE));
    return json(res, 200, {
      CardInfoSearch: {
        searchID: cond.searchID ?? randomUUID(),
        responseStatusStrg: pg.more ? "MORE" : "OK",
        numOfMatches: pg.slice.length,
        totalMatches: pg.total,
        CardInfo: pg.slice,
      },
    });
  }
  if (path === "/ISAPI/AccessControl/CardInfo/SetUp" && method === "PUT") {
    const info = parse(body).CardInfo ?? {};
    const p = persons.get(String(info.employeeNo));
    if (!p) return fail(res, "employeeNoNotExist");
    if (!info.cardNo) return fail(res, "cardNoNotExist");
    if (cards.has(String(info.cardNo))) return fail(res, "cardNoAlreadyExist");
    if (cards.size >= MAX_CARDS) return fail(res, "noEnoughMemory");
    cards.set(String(info.cardNo), { cardNo: String(info.cardNo), employeeNo: p.employeeNo, cardType: info.cardType ?? "normalCard" });
    p.cards.push(String(info.cardNo));
    return ok(res);
  }
  if (path === "/ISAPI/AccessControl/CardInfo/Delete" && method === "PUT") {
    const list: Array<{ cardNo: string }> = parse(body).CardInfoDelCond?.CardNoList ?? [];
    for (const { cardNo } of list) {
      const c = cards.get(String(cardNo));
      if (!c) continue;
      const p = persons.get(c.employeeNo);
      if (p) p.cards = p.cards.filter((x) => x !== c.cardNo);
      cards.delete(c.cardNo);
    }
    return ok(res);
  }

  // ── Eventos (búsqueda, igual que AcsEvent del equipo) ───────────────
  if (path === "/ISAPI/AccessControl/AcsEvent" && method === "POST") {
    const cond = parse(body).AcsEventCond ?? {};
    const from = Number(cond.beginSerialNo ?? 0);
    const to = Number(cond.endSerialNo ?? Number.MAX_SAFE_INTEGER);
    const minor = cond.minor;
    const all = events
      .filter((e) => e.serialNo >= from && e.serialNo <= to)
      // minor 0 = todos los tipos, como en el equipo real.
      .filter((e) => minor === undefined || Number(minor) === 0 || e.minor === Number(minor));
    const pg = page(all, Number(cond.searchResultPosition ?? 0), Number(cond.maxResults ?? PAGE));
    return json(res, 200, {
      AcsEvent: {
        searchID: cond.searchID ?? randomUUID(),
        responseStatusStrg: pg.more ? "MORE" : pg.total === 0 ? "NO MATCH" : "OK",
        numOfMatches: pg.slice.length,
        totalMatches: pg.total,
        InfoList: pg.slice.map((e) => ({ major: 5, ...e })),
      },
    });
  }

  return json(res, 404, { statusCode: 4, statusString: "Not Found", subStatusCode: "notSupport" });
};

reset();
createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    console.error("[mock] error", err);
    if (!res.headersSent) json(res, 500, { statusCode: 4, statusString: "Mock error" });
  });
}).listen(PORT, HOST, () => {
  console.log(`[mock] ISAPI de prueba en http://${HOST}:${PORT}  (usuario: ${USER})`);
  console.log("[mock] no toca ningún reloj real; estado en memoria");
});
