/**
 * Convierte un respaldo (`pg_dump` en texto plano) de la base PRODUCTIVA con el
 * modelo viejo de inventario (`devices` / `device_types` / `cartas_responsivas`
 * / `carta_items` / `inventory_movements` / `device_history`) a los fixtures
 * que consume `prisma/seed.ts`, ya en el modelo nuevo
 * (`TipoDispositivo` / `Dispositivo` / `UnidadFisica` / `Movimiento` /
 * `Prestamo`).
 *
 * Uso:  npm run legacy:extract -- [ruta/al/backup.sql]
 *       (por omisión `prisma/legacy/backup.sql`)
 *
 * El conversor es idempotente y determinista: los ids de las filas que ya
 * existían se conservan tal cual (una `UnidadFisica` hereda el id del `device`,
 * un `Prestamo` el de su carta, etc.) y los ids nuevos se derivan por UUIDv5,
 * así que volver a correrlo sobre el mismo respaldo produce el mismo resultado.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Row = Record<string, string | null>;
type Dump = Record<string, Row[]>;

const SRC = path.resolve(process.argv[2] ?? path.join(__dirname, "backup.sql"));
const OUT = path.join(__dirname, "..", "seed-data");

// ---------------------------------------------------------------------------
// Lectura del dump: sólo interesan los bloques `COPY ... FROM stdin;`.
// ---------------------------------------------------------------------------
function unescape(value: string): string | null {
  if (value === "\\N") return null;
  return value
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function readDump(file: string): Dump {
  // El respaldo puede venir con fines de línea CRLF (se generó en Windows).
  const lines = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const dump: Dump = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("COPY public.")) continue;
    const table = line.split(" ")[1].replace("public.", "");
    const cols = line
      .slice(line.indexOf("(") + 1, line.lastIndexOf(")"))
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""));
    const rows: Row[] = [];
    let j = i + 1;
    for (; lines[j] !== "\\."; j++) {
      const values = lines[j].split("\t").map(unescape);
      rows.push(Object.fromEntries(cols.map((c, k) => [c, values[k] ?? null])));
    }
    dump[table] = rows;
    i = j;
  }
  return dump;
}

// ---------------------------------------------------------------------------
// Helpers de conversión de tipos del dump (todo llega como texto).
// ---------------------------------------------------------------------------
const bool = (v: string | null) => v === "t";
const int = (v: string | null) => (v === null ? 0 : Number(v));
const json = (v: string | null) => (v === null ? null : JSON.parse(v));

/** UUIDv5 (namespace fijo) para las filas que el modelo viejo no tenía. */
const NS = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
function uuid5(name: string): string {
  const h = crypto.createHash("sha1").update(NS).update(name, "utf8").digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const clean = (v: string | null) => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

// `N/A`, `N/A1`, `-`… son marcadores de "sin dato" que el modelo viejo exigía
// por tener columnas NOT NULL; en el nuevo esos campos son opcionales.
const NO_DATA = /^(n\/?a\.?\d*|na\d*|-+|sin dato|ninguno)$/i;
const optional = (v: string | null) => {
  const t = clean(v);
  return t && !NO_DATA.test(t) ? t : null;
};

// Valores del respaldo viejo → valores de los enums nuevos. Las llaves son datos
// del dump (siguen como estaban en el modelo viejo).
const UNIT_STATUS: Record<string, string> = {
  "DISPONIBLE": "AVAILABLE",
  "ASIGNADO": "ON_LOAN",
  "BAJA": "RETIRED",
};
const ROLE: Record<string, string> = {
  "GERENTE": "MANAGER",
  "JEFE_DE_AREA": "AREA_HEAD",
  "EMPLEADO": "EMPLOYEE",
  "RECURSOS_HUMANOS": "HUMAN_RESOURCES",
};
const TICKET_STATUS: Record<string, string> = { "ABIERTO": "OPEN", "EN_SEGUIMIENTO": "IN_PROGRESS", "CERRADO": "CLOSED" };
const TICKET_PRIORITY: Record<string, string> = { "BAJA": "LOW", "MEDIA": "MEDIUM", "ALTA": "HIGH", "URGENTE": "URGENT" };
const ASSIGNMENT_STATUS: Record<string, string> = {
  "PENDIENTE": "PENDING",
  "EN_PROGRESO": "IN_PROGRESS",
  "EN_REVISION": "IN_REVIEW",
  "COMPLETADA": "COMPLETED",
};
const MATERIAL_OUTPUT_REASON: Record<string, string> = { "DANADO": "DAMAGED", "OBSOLETO": "OBSOLETE", "EXTRAVIO": "LOST", "OTRO": "OTHER" };
const AUDIT_ACTION: Record<string, string> = { "DEVICE_LOTE_EXPANDED": "DEVICE_BATCH_EXPANDED", "MOVEMENT_SALIDA": "MOVEMENT_STOCK_OUT" };
const mapValue = (map: Record<string, string>, v: string | null) => (v === null ? null : map[v] ?? v);

// ---------------------------------------------------------------------------
// Nombres: el modelo viejo guardaba todo en `name`, mezclando dos órdenes
// ("APELLIDOS NOMBRES" de la nómina y "NOMBRES APELLIDOS"). El `username` los
// desambigua: es la inicial del primer nombre + el apellido paterno
// (`apalma` = Ana PALMA, `amedrano` = Anabel MEDRANO), así que el apellido
// paterno es el token que coincide con el username y su posición dice el orden.
// ---------------------------------------------------------------------------
type Name = {
  name: string;
  middleName: string | null;
  paternalSurname: string | null;
  maternalSurname: string | null;
};

const withoutAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const notices: string[] = [];

function splitName(complete: string, username: string): Name {
  const tokens = complete.trim().split(/\s+/).filter(Boolean);
  const empty: Name = {
    name: complete.trim(),
    middleName: null,
    paternalSurname: null,
    maternalSurname: null,
  };
  if (tokens.length < 2) return empty;

  const user = withoutAccents(username);
  const slug = user.slice(1);
  let idx = tokens.findIndex((t) => withoutAccents(t) === slug);

  if (idx === -1) {
    // El username no sigue la convención (p. ej. `MarcoH` = Marco + H.).
    // Si empieza con el primer token, el nombre va primero; si no, se asume el
    // orden de nómina. En ambos casos se avisa para que se revise a mano.
    idx = user.startsWith(withoutAccents(tokens[0])) ? 1 : 0;
    notices.push(`${username}: "${complete}" no coincide con el username; se asumió ${idx === 1 ? "NOMBRES primero" : "APELLIDOS primero"}`);
  }

  let names: string[];
  let maternal: string[];
  if (idx === 0) {
    // APELLIDO_PATERNO APELLIDO_MATERNO NOMBRES
    names = tokens.slice(2);
    maternal = tokens.slice(1, 2);
    if (names.length === 0) {
      // Sólo hay dos tokens: el segundo es el nombre, no el apellido materno.
      names = maternal;
      maternal = [];
    }
  } else {
    // NOMBRES APELLIDO_PATERNO APELLIDO_MATERNO
    names = tokens.slice(0, idx);
    maternal = tokens.slice(idx + 1);
  }

  if (names[0] && withoutAccents(names[0])[0] !== user[0]) {
    notices.push(`${username}: el primer nombre "${names[0]}" no empieza con "${username[0]}"`);
  }

  return {
    name: names[0] ?? tokens[idx],
    middleName: names.slice(1).join(" ") || null,
    paternalSurname: tokens[idx] ?? null,
    maternalSurname: maternal.join(" ") || null,
  };
}

/** Nombre completo como lo compone la app: nombres primero, luego apellidos. */
const fullName = (n: Name) =>
  [n.name, n.middleName, n.paternalSurname, n.maternalSurname].filter(Boolean).join(" ");

function write(name: string, rows: unknown[]) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`  ${String(rows.length).padStart(4)}  ${name}.json`);
}

// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(SRC)) throw new Error(`No existe el respaldo: ${SRC}`);
  console.log(`Respaldo: ${SRC}\n`);
  const db = readDump(SRC);
  const rows = (t: string) => db[t] ?? [];

  // -- Tablas que el modelo nuevo conserva sin cambios -----------------------
  write(
    "departments",
    rows("departments").map((d) => ({
      id: d.id,
      name: d.name,
      active: bool(d.active),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }))
  );

  write(
    "subareas",
    rows("subareas").map((s) => ({
      id: s.id,
      departmentId: s.departmentId,
      name: s.name,
      active: bool(s.active),
      createdAt: s.createdAt,
    }))
  );

  const users = rows("users");
  const names = new Map(
    users.map((u) => [u.id as string, splitName(u.name ?? "", u.username ?? "")])
  );
  /** Nombre ya normalizado, para todo lo que guarda el nombre como texto. */
  const nameOf = (id: string | null) => {
    const n = id ? names.get(id) : undefined;
    return n ? fullName(n) : null;
  };

  write(
    "users",
    users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      password: u.password,
      ...names.get(u.id as string)!,
      name: fullName(names.get(u.id as string)!),
      role: mapValue(ROLE, u.role),
      active: bool(u.active),
      jobTitle: u.puesto,
      employeeNumber: u.numeroEmpleado,
      company: u.empresa,
      departmentId: u.departmentId,
      subareaId: u.subareaId,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }))
  );

  write(
    "tickets",
    rows("tickets").map((t) => ({
      id: t.id,
      title: t.titulo,
      description: t.descripcion,
      status: mapValue(TICKET_STATUS, t.status),
      priority: mapValue(TICKET_PRIORITY, t.priority),
      category: t.category,
      createdById: t.creadoPorId,
      assignedToId: t.asignadoAId,
      departmentId: t.departmentId,
      closedAt: t.closedAt,
      closedBy: t.closedBy,
      createdAt: t.creadoEn,
      updatedAt: t.actualizadoEn,
      deletedAt: t.deletedAt,
    }))
  );

  write(
    "ticket_assignments",
    rows("ticket_assignments").map((a) => ({
      id: a.id,
      ticketId: a.ticketId,
      userId: a.userId,
      title: a.title,
      description: a.description,
      status: mapValue(ASSIGNMENT_STATUS, a.status),
      startDate: a.startDate,
      dueDate: a.dueDate,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
  );

  write(
    "ticket_assignment_comments",
    rows("ticket_assignment_comments").map((c) => ({
      id: c.id,
      assignmentId: c.assignmentId,
      authorId: c.autorId,
      text: c.texto,
      createdAt: c.createdAt,
    }))
  );

  write(
    "ticket_attachments",
    rows("ticket_attachments").map((a) => ({
      id: a.id,
      ticketId: a.ticketId,
      assignmentId: a.assignmentId,
      uploadedById: a.uploadedById,
      storageKey: a.storageKey,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: int(a.sizeBytes),
      kind: a.kind,
      createdAt: a.createdAt,
    }))
  );

  write(
    "ticket_comments",
    rows("ticket_comments").map((c) => ({
      id: c.id,
      ticketId: c.ticketId,
      authorId: c.autorId,
      text: c.texto,
      createdAt: c.creadoEn,
    }))
  );

  write(
    "ticket_history",
    rows("ticket_history").map((h) => ({
      id: h.id,
      ticketId: h.ticketId,
      type: h.type,
      detail: h.detail,
      authorId: h.autorId,
      createdAt: h.createdAt,
    }))
  );

  write(
    "notifications",
    rows("notifications").map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      detail: n.detail,
      ticketId: n.ticketId,
      read: bool(n.read),
      createdAt: n.createdAt,
    }))
  );

  write(
    "legacy_sequences",
    rows("consecutivos").map((c) => ({
      id: c.id,
      prefix: c.prefijo,
      counter: int(c.contador),
      updatedAt: c.actualizadoEn,
    }))
  );

  // -- Inventario: modelo viejo -> modelo nuevo ------------------------------
  // `device_types` -> `TipoDispositivo`. El `fieldConfig` (JSON de campos
  // habilitados por tipo) pasa a las banderas `useSerie/useMac/useIp/useEquipo`.
  // `contador` se conserva para que el folio de activo fijo siga la serie.
  write(
    "device_types",
    rows("device_types").map((t) => {
      const cfg = json(t.fieldConfig) ?? {};
      const on = (k: string) => Boolean(cfg[k]?.enabled);
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        assetTagPrefix: t.prefix,
        counter: int(t.contador),
        active: bool(t.active),
        useSerialNumber: on("numeroSerie"),
        useMac: on("macAddress"),
        useIp: on("ip"),
        useHostname: on("nombreEquipo"),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    })
  );

  // Un `device` viejo era una unidad física suelta; el lote (`loteId`) agrupaba
  // las unidades del mismo modelo. Ese lote es exactamente el `Dispositivo`
  // nuevo (catálogo) y cada `device` una `UnidadFisica`.
  const devices = rows("devices");
  const deviceCatalog: Record<string, any> = {};
  const units: any[] = [];

  for (const d of devices) {
    const batchId = d.loteId ?? uuid5(`lote:${d.id}`);
    if (!deviceCatalog[batchId]) {
      const specs = [
        d.sistema_op && `SO: ${d.sistema_op.trim()}`,
        d.ram && `RAM: ${d.ram.trim()}`,
        d.almacenamiento && `Almacenamiento: ${d.almacenamiento.trim()}`,
      ].filter(Boolean);
      deviceCatalog[batchId] = {
        id: batchId,
        typeId: d.typeId,
        // El modelo viejo no tenía nombre corto: se arma con marca + modelo,
        // que es único por tipo en el respaldo.
        name: `${(d.marca ?? "").trim()} ${(d.modelo ?? "").trim()}`.trim(),
        brand: (d.marca ?? "").trim(),
        model: (d.modelo ?? "").trim(),
        description: clean(d.descripcion),
        notes: specs.length > 0 ? specs.join(" · ") : null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    }
    units.push({
      id: d.id,
      deviceId: batchId,
      assetTag: d.controlActivos,
      serialNumber: optional(d.numeroSerie),
      macAddress: optional(d.mac_address),
      ip: optional(d.ip),
      hostname: optional(d.nombreEquipo),
      area: d.area ?? "SISTEMAS",
      status: UNIT_STATUS[d.estado ?? "DISPONIBLE"] ?? "AVAILABLE",
      departmentId: d.departmentId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  write("devices", Object.values(deviceCatalog));
  write("device_units", units);

  const unitById = new Map(units.map((u) => [u.id, u]));
  const deptByName = new Map(
    rows("departments").map((d) => [(d.name ?? "").toUpperCase(), d.id as string])
  );
  const adminId =
    users.find((u) => u.role === "ADMIN")?.id ?? users[0]?.id ?? null;

  const movements: any[] = [];
  const movementItems: any[] = [];
  const movementItemUnits: any[] = [];

  function movement(
    id: string,
    data: Record<string, unknown>,
    unitIds: string[],
    item: Record<string, unknown> = {}
  ) {
    const u = unitById.get(unitIds[0]);
    if (!u) return;
    movements.push({ id, status: "ACTIVE", ...data });
    const itemId = uuid5(`movdet:${id}:${u.deviceId}`);
    movementItems.push({
      id: itemId,
      movementId: id,
      deviceId: u.deviceId,
      quantity: unitIds.length,
      condition: null,
      notes: null,
      ...item,
    });
    for (const deviceUnitId of unitIds) {
      movementItemUnits.push({
        id: uuid5(`movdetuni:${itemId}:${deviceUnitId}`),
        movementItemId: itemId,
        deviceUnitId,
      });
    }
  }

  // 1) ENTRADA por alta: el modelo viejo sólo dejaba rastro en `device_history`
  //    (CREATED / LOTE_EXPANDED). Se reconstruye un movimiento de ENTRADA por
  //    lote y fecha de alta, con las unidades dadas de alta en esa tanda.
  const registrationAuthor = new Map(
    rows("device_history")
      .filter((h) => h.type === "CREATED")
      .map((h) => [h.deviceId as string, h.autorId])
  );
  const batches = new Map<string, string[]>();
  for (const u of units) {
    const key = `${u.deviceId}|${String(u.createdAt).slice(0, 19)}`;
    const batch = batches.get(key);
    if (batch) batch.push(u.id);
    else batches.set(key, [u.id]);
  }
  for (const [key, ids] of batches) {
    const [deviceId, date] = key.split("|");
    const userId = registrationAuthor.get(ids[0]) ?? adminId;
    if (!userId) continue;
    const id = uuid5(`entrada:${deviceId}:${date}`);
    movement(
      id,
      {
        type: "STOCK_IN",
        date: unitById.get(ids[0])!.createdAt,
        createdById: userId,
        custodianId: null,
        departmentId: null,
        reason: "Alta inicial",
        notes: null,
        createdAt: unitById.get(ids[0])!.createdAt,
        updatedAt: unitById.get(ids[0])!.createdAt,
      },
      ids
    );
  }

  // 2) PRESTAMO por carta responsiva: la carta pasa a `Prestamo` (conserva su
  //    consecutivo original) + el `Movimiento` de PRESTAMO que ahora el modelo
  //    exige. Si el respaldo ya traía el movimiento viejo, se reusa su id/fecha.
  const legacyLetters = rows("cartas_responsivas");
  const items = rows("carta_items");
  const itemsByCustodyLetter = new Map<string, Row[]>();
  for (const it of items) {
    const list = itemsByCustodyLetter.get(it.cartaId!) ?? [];
    list.push(it);
    itemsByCustodyLetter.set(it.cartaId!, list);
  }
  const legacyMovements = rows("inventory_movements");
  const movementByCustodyLetter = new Map(
    legacyMovements
      .filter((m) => m.tipo === "PRESTAMO" && m.notas?.startsWith("Carta "))
      .map((m) => [m.notas!.replace("Carta ", "").trim(), m])
  );

  const loans: any[] = [];
  const loanItems: any[] = [];
  const loanItemUnits: any[] = [];

  for (const c of legacyLetters) {
    const own = itemsByCustodyLetter.get(c.id!) ?? [];
    const unitIds = own
      .map((it) => it.deviceId!)
      .filter((id) => unitById.has(id));
    if (unitIds.length === 0) continue;

    const departmentId =
      c.departmentId ?? deptByName.get((c.departamento ?? "").toUpperCase()) ?? null;
    const old = movementByCustodyLetter.get(c.consecutive ?? "");
    const movementId = old?.id ?? uuid5(`prestamo-mov:${c.id}`);

    movement(
      movementId,
      {
        type: "LOAN",
        date: old?.createdAt ?? c.fecha,
        createdById: c.creadoPorId,
        custodianId: c.responsableId,
        departmentId,
        reason: `Carta ${c.consecutive}`,
        notes: null,
        createdAt: old?.createdAt ?? c.creadoEn,
        updatedAt: old?.createdAt ?? c.creadoEn,
      },
      unitIds
    );

    // Datos de la carta que el modelo nuevo ya no tiene columna propia para
    // guardar, pero que están impresos en la responsiva firmada.
    const supervisor = nameOf(c.encargadoId);
    const notes =
      [
        c.deliveryBy && `Entregado por: ${c.deliveryBy}`,
        supervisor && `Encargado: ${supervisor}`,
        c.empresa && `Empresa: ${c.empresa}`,
        c.numeroEmpleado && `No. empleado: ${c.numeroEmpleado}`,
      ]
        .filter(Boolean)
        .join(" · ") || null;

    loans.push({
      id: c.id,
      number: c.consecutive,
      date: c.fecha,
      status: "ACTIVE",
      custodianId: c.responsableId,
      departmentId,
      subareaId: c.subareaId,
      movementId: movementId,
      notes,
      createdAt: c.creadoEn,
      updatedAt: c.actualizadoEn,
    });

    for (const it of own) {
      const u = unitById.get(it.deviceId!);
      if (!u) continue;
      loanItems.push({
        id: it.id,
        loanId: c.id,
        deviceId: u.deviceId,
        quantity: 1,
        returnedQuantity: 0,
        notes: null,
      });
      loanItemUnits.push({
        id: uuid5(`predetuni:${it.id}:${u.id}`),
        loanItemId: it.id,
        deviceUnitId: u.id,
        returned: false,
      });
    }
  }

  // 3) Las salidas sueltas del modelo viejo (`SALIDA`) no cambiaban el estado
  //    del equipo; se conservan como historial de ajuste para no inventar bajas.
  for (const m of legacyMovements) {
    if (m.tipo !== "SALIDA" || !unitById.has(m.deviceId ?? "")) continue;
    movement(
      m.id!,
      {
        type: "ADJUSTMENT_OUT",
        date: m.createdAt,
        createdById: m.userId,
        custodianId: null,
        departmentId: m.departmentId,
        reason: clean(m.notas) ?? "Salida de material",
        notes: null,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      },
      [m.deviceId!]
    );
  }

  write("movements", movements);
  write("movement_items", movementItems);
  write("movement_item_units", movementItemUnits);
  write("loans", loans);
  write("loan_items", loanItems);
  write("loan_item_units", loanItemUnits);

  write(
    "material_outputs",
    rows("material_outputs").map((o) => ({
      id: o.id,
      date: o.fecha,
      description: o.descripcion,
      model: o.modelo,
      brand: o.marca,
      project: o.proyecto,
      quantity: int(o.cantidad),
      departmentName: o.departamento,
      userName: o.usuario,
      notes: o.observaciones,
      area: o.area ?? "Sistemas",
      reason: mapValue(MATERIAL_OUTPUT_REASON, o.motivo),
      deviceUnitId: unitById.has(o.deviceId ?? "") ? o.deviceId : null,
      registeredById: o.registradoPorId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }))
  );

  // `device_history` desaparece como tabla; su rastro se conserva en la
  // bitácora de auditoría, que sí sobrevive y ya indexa por equipo.
  const audit = rows("audit_logs").map((a) => ({
    id: a.id,
    action: mapValue(AUDIT_ACTION, a.action),
    entityType: a.entityType,
    entityId: a.entityId,
    userId: a.userId,
    userName: nameOf(a.userId) ?? a.userName,
    deviceId: a.deviceId,
    deviceCode: a.deviceCode,
    previousState: json(a.previousState),
    newState: json(a.newState),
    metadata: json(a.metadata),
    createdAt: a.createdAt,
  }));

  for (const h of rows("device_history")) {
    const u = unitById.get(h.deviceId ?? "");
    audit.push({
      id: h.id,
      action: mapValue(AUDIT_ACTION, `DEVICE_${h.type}`),
      entityType: "DeviceUnit",
      entityId: h.deviceId,
      userId: h.autorId,
      userName: nameOf(h.autorId),
      deviceId: h.deviceId,
      deviceCode: u?.assetTag ?? null,
      previousState: null,
      newState: null,
      metadata: { detail: h.detail, source: "device_history" },
      createdAt: h.createdAt,
    });
  }
  audit.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  write("audit_logs", audit);

  // Fixtures del modelo viejo que ya no existen en el esquema nuevo.
  for (const obsolete of [
    "device_history",
    "cartas_responsivas",
    "carta_items",
    "inventory_movements",
  ]) {
    const file = path.join(OUT, `${obsolete}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  if (notices.length > 0) {
    console.log("\nNombres que no siguen la convención del username (revisar):");
    for (const a of notices) console.log(`  ! ${a}`);
  }

  console.log(
    `\nEquipos: ${devices.length} unidades físicas en ${Object.keys(deviceCatalog).length} dispositivos.` +
      `\nCartas responsivas: ${loans.length} préstamos activos.` +
      `\nMovimientos reconstruidos: ${movements.length}.`
  );
}

main();
