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

const ESTADO: Record<string, string> = {
  DISPONIBLE: "DISPONIBLE",
  ASIGNADO: "PRESTADO",
  BAJA: "BAJA",
};

// ---------------------------------------------------------------------------
// Nombres: el modelo viejo guardaba todo en `name`, mezclando dos órdenes
// ("APELLIDOS NOMBRES" de la nómina y "NOMBRES APELLIDOS"). El `username` los
// desambigua: es la inicial del primer nombre + el apellido paterno
// (`apalma` = Ana PALMA, `amedrano` = Anabel MEDRANO), así que el apellido
// paterno es el token que coincide con el username y su posición dice el orden.
// ---------------------------------------------------------------------------
type Nombre = {
  name: string;
  segundoNombre: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
};

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const avisos: string[] = [];

function partirNombre(completo: string, username: string): Nombre {
  const tokens = completo.trim().split(/\s+/).filter(Boolean);
  const vacio: Nombre = {
    name: completo.trim(),
    segundoNombre: null,
    apellidoPaterno: null,
    apellidoMaterno: null,
  };
  if (tokens.length < 2) return vacio;

  const user = sinAcentos(username);
  const slug = user.slice(1);
  let idx = tokens.findIndex((t) => sinAcentos(t) === slug);

  if (idx === -1) {
    // El username no sigue la convención (p. ej. `MarcoH` = Marco + H.).
    // Si empieza con el primer token, el nombre va primero; si no, se asume el
    // orden de nómina. En ambos casos se avisa para que se revise a mano.
    idx = user.startsWith(sinAcentos(tokens[0])) ? 1 : 0;
    avisos.push(`${username}: "${completo}" no coincide con el username; se asumió ${idx === 1 ? "NOMBRES primero" : "APELLIDOS primero"}`);
  }

  let nombres: string[];
  let materno: string[];
  if (idx === 0) {
    // APELLIDO_PATERNO APELLIDO_MATERNO NOMBRES
    nombres = tokens.slice(2);
    materno = tokens.slice(1, 2);
    if (nombres.length === 0) {
      // Sólo hay dos tokens: el segundo es el nombre, no el apellido materno.
      nombres = materno;
      materno = [];
    }
  } else {
    // NOMBRES APELLIDO_PATERNO APELLIDO_MATERNO
    nombres = tokens.slice(0, idx);
    materno = tokens.slice(idx + 1);
  }

  if (nombres[0] && sinAcentos(nombres[0])[0] !== user[0]) {
    avisos.push(`${username}: el primer nombre "${nombres[0]}" no empieza con "${username[0]}"`);
  }

  return {
    name: nombres[0] ?? tokens[idx],
    segundoNombre: nombres.slice(1).join(" ") || null,
    apellidoPaterno: tokens[idx] ?? null,
    apellidoMaterno: materno.join(" ") || null,
  };
}

/** Nombre completo como lo compone la app: nombres primero, luego apellidos. */
const nombreCompleto = (n: Nombre) =>
  [n.name, n.segundoNombre, n.apellidoPaterno, n.apellidoMaterno].filter(Boolean).join(" ");

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
  const nombres = new Map(
    users.map((u) => [u.id as string, partirNombre(u.name ?? "", u.username ?? "")])
  );
  /** Nombre ya normalizado, para todo lo que guarda el nombre como texto. */
  const nombreDe = (id: string | null) => {
    const n = id ? nombres.get(id) : undefined;
    return n ? nombreCompleto(n) : null;
  };

  write(
    "users",
    users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      password: u.password,
      ...nombres.get(u.id as string)!,
      name: nombreCompleto(nombres.get(u.id as string)!),
      role: u.role,
      active: bool(u.active),
      puesto: u.puesto,
      numeroEmpleado: u.numeroEmpleado,
      empresa: u.empresa,
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
      titulo: t.titulo,
      descripcion: t.descripcion,
      status: t.status,
      priority: t.priority,
      category: t.category,
      creadoPorId: t.creadoPorId,
      asignadoAId: t.asignadoAId,
      departmentId: t.departmentId,
      closedAt: t.closedAt,
      closedBy: t.closedBy,
      creadoEn: t.creadoEn,
      actualizadoEn: t.actualizadoEn,
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
      status: a.status,
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
      autorId: c.autorId,
      texto: c.texto,
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
      autorId: c.autorId,
      texto: c.texto,
      creadoEn: c.creadoEn,
    }))
  );

  write(
    "ticket_history",
    rows("ticket_history").map((h) => ({
      id: h.id,
      ticketId: h.ticketId,
      type: h.type,
      detail: h.detail,
      autorId: h.autorId,
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
    "consecutivos",
    rows("consecutivos").map((c) => ({
      id: c.id,
      prefijo: c.prefijo,
      contador: int(c.contador),
      actualizadoEn: c.actualizadoEn,
    }))
  );

  // -- Inventario: modelo viejo -> modelo nuevo ------------------------------
  // `device_types` -> `TipoDispositivo`. El `fieldConfig` (JSON de campos
  // habilitados por tipo) pasa a las banderas `useSerie/useMac/useIp/useEquipo`.
  // `contador` se conserva para que el folio de activo fijo siga la serie.
  write(
    "tipos_dispositivo",
    rows("device_types").map((t) => {
      const cfg = json(t.fieldConfig) ?? {};
      const on = (k: string) => Boolean(cfg[k]?.enabled);
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        folioPrefix: t.prefix,
        contador: int(t.contador),
        active: bool(t.active),
        useSerie: on("numeroSerie"),
        useMac: on("macAddress"),
        useIp: on("ip"),
        useEquipo: on("nombreEquipo"),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    })
  );

  // Un `device` viejo era una unidad física suelta; el lote (`loteId`) agrupaba
  // las unidades del mismo modelo. Ese lote es exactamente el `Dispositivo`
  // nuevo (catálogo) y cada `device` una `UnidadFisica`.
  const devices = rows("devices");
  const dispositivos: Record<string, any> = {};
  const unidades: any[] = [];

  for (const d of devices) {
    const loteId = d.loteId ?? uuid5(`lote:${d.id}`);
    if (!dispositivos[loteId]) {
      const specs = [
        d.sistema_op && `SO: ${d.sistema_op.trim()}`,
        d.ram && `RAM: ${d.ram.trim()}`,
        d.almacenamiento && `Almacenamiento: ${d.almacenamiento.trim()}`,
      ].filter(Boolean);
      dispositivos[loteId] = {
        id: loteId,
        tipoId: d.typeId,
        // El modelo viejo no tenía nombre corto: se arma con marca + modelo,
        // que es único por tipo en el respaldo.
        nombre: `${(d.marca ?? "").trim()} ${(d.modelo ?? "").trim()}`.trim(),
        marca: (d.marca ?? "").trim(),
        modelo: (d.modelo ?? "").trim(),
        descripcion: clean(d.descripcion),
        observaciones: specs.length > 0 ? specs.join(" · ") : null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    }
    unidades.push({
      id: d.id,
      dispositivoId: loteId,
      activoFijo: d.controlActivos,
      numeroSerie: optional(d.numeroSerie),
      macAddress: optional(d.mac_address),
      ip: optional(d.ip),
      nombreEquipo: optional(d.nombreEquipo),
      area: d.area ?? "SISTEMAS",
      estado: ESTADO[d.estado ?? "DISPONIBLE"] ?? "DISPONIBLE",
      departamentoId: d.departmentId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  write("dispositivos", Object.values(dispositivos));
  write("unidades_fisicas", unidades);

  const unidadById = new Map(unidades.map((u) => [u.id, u]));
  const deptByName = new Map(
    rows("departments").map((d) => [(d.name ?? "").toUpperCase(), d.id as string])
  );
  const adminId =
    users.find((u) => u.role === "ADMIN")?.id ?? users[0]?.id ?? null;

  const movimientos: any[] = [];
  const movDetalles: any[] = [];
  const movDetalleUnidades: any[] = [];

  function movimiento(
    id: string,
    data: Record<string, unknown>,
    unidadIds: string[],
    detalle: Record<string, unknown> = {}
  ) {
    const u = unidadById.get(unidadIds[0]);
    if (!u) return;
    movimientos.push({ id, status: "ACTIVO", ...data });
    const detalleId = uuid5(`movdet:${id}:${u.dispositivoId}`);
    movDetalles.push({
      id: detalleId,
      movimientoId: id,
      dispositivoId: u.dispositivoId,
      cantidad: unidadIds.length,
      condicion: null,
      observaciones: null,
      ...detalle,
    });
    for (const unidadFisicaId of unidadIds) {
      movDetalleUnidades.push({
        id: uuid5(`movdetuni:${detalleId}:${unidadFisicaId}`),
        movimientoDetalleId: detalleId,
        unidadFisicaId,
      });
    }
  }

  // 1) ENTRADA por alta: el modelo viejo sólo dejaba rastro en `device_history`
  //    (CREATED / LOTE_EXPANDED). Se reconstruye un movimiento de ENTRADA por
  //    lote y fecha de alta, con las unidades dadas de alta en esa tanda.
  const altaAutor = new Map(
    rows("device_history")
      .filter((h) => h.type === "CREATED")
      .map((h) => [h.deviceId as string, h.autorId])
  );
  const tandas = new Map<string, string[]>();
  for (const u of unidades) {
    const key = `${u.dispositivoId}|${String(u.createdAt).slice(0, 19)}`;
    const tanda = tandas.get(key);
    if (tanda) tanda.push(u.id);
    else tandas.set(key, [u.id]);
  }
  for (const [key, ids] of tandas) {
    const [dispositivoId, fecha] = key.split("|");
    const usuarioId = altaAutor.get(ids[0]) ?? adminId;
    if (!usuarioId) continue;
    const id = uuid5(`entrada:${dispositivoId}:${fecha}`);
    movimiento(
      id,
      {
        tipo: "ENTRADA",
        fecha: unidadById.get(ids[0])!.createdAt,
        usuarioId,
        responsableId: null,
        departamentoId: null,
        motivo: "Alta inicial",
        observaciones: null,
        createdAt: unidadById.get(ids[0])!.createdAt,
        updatedAt: unidadById.get(ids[0])!.createdAt,
      },
      ids
    );
  }

  // 2) PRESTAMO por carta responsiva: la carta pasa a `Prestamo` (conserva su
  //    consecutivo original) + el `Movimiento` de PRESTAMO que ahora el modelo
  //    exige. Si el respaldo ya traía el movimiento viejo, se reusa su id/fecha.
  const cartas = rows("cartas_responsivas");
  const items = rows("carta_items");
  const itemsByCarta = new Map<string, Row[]>();
  for (const it of items) {
    const list = itemsByCarta.get(it.cartaId!) ?? [];
    list.push(it);
    itemsByCarta.set(it.cartaId!, list);
  }
  const movViejos = rows("inventory_movements");
  const movPorCarta = new Map(
    movViejos
      .filter((m) => m.tipo === "PRESTAMO" && m.notas?.startsWith("Carta "))
      .map((m) => [m.notas!.replace("Carta ", "").trim(), m])
  );

  const prestamos: any[] = [];
  const prestamoDetalles: any[] = [];
  const prestamoDetalleUnidades: any[] = [];

  for (const c of cartas) {
    const propios = itemsByCarta.get(c.id!) ?? [];
    const unidadIds = propios
      .map((it) => it.deviceId!)
      .filter((id) => unidadById.has(id));
    if (unidadIds.length === 0) continue;

    const departamentoId =
      c.departmentId ?? deptByName.get((c.departamento ?? "").toUpperCase()) ?? null;
    const viejo = movPorCarta.get(c.consecutive ?? "");
    const movId = viejo?.id ?? uuid5(`prestamo-mov:${c.id}`);

    movimiento(
      movId,
      {
        tipo: "PRESTAMO",
        fecha: viejo?.createdAt ?? c.fecha,
        usuarioId: c.creadoPorId,
        responsableId: c.responsableId,
        departamentoId,
        motivo: `Carta ${c.consecutive}`,
        observaciones: null,
        createdAt: viejo?.createdAt ?? c.creadoEn,
        updatedAt: viejo?.createdAt ?? c.creadoEn,
      },
      unidadIds
    );

    // Datos de la carta que el modelo nuevo ya no tiene columna propia para
    // guardar, pero que están impresos en la responsiva firmada.
    const encargado = nombreDe(c.encargadoId);
    const observaciones =
      [
        c.deliveryBy && `Entregado por: ${c.deliveryBy}`,
        encargado && `Encargado: ${encargado}`,
        c.empresa && `Empresa: ${c.empresa}`,
        c.numeroEmpleado && `No. empleado: ${c.numeroEmpleado}`,
      ]
        .filter(Boolean)
        .join(" · ") || null;

    prestamos.push({
      id: c.id,
      consecutivo: c.consecutive,
      fecha: c.fecha,
      status: "ACTIVO",
      responsableId: c.responsableId,
      departamentoId,
      subareaId: c.subareaId,
      movimientoId: movId,
      observaciones,
      createdAt: c.creadoEn,
      updatedAt: c.actualizadoEn,
    });

    for (const it of propios) {
      const u = unidadById.get(it.deviceId!);
      if (!u) continue;
      prestamoDetalles.push({
        id: it.id,
        prestamoId: c.id,
        dispositivoId: u.dispositivoId,
        cantidad: 1,
        devuelto: 0,
        observaciones: null,
      });
      prestamoDetalleUnidades.push({
        id: uuid5(`predetuni:${it.id}:${u.id}`),
        prestamoDetalleId: it.id,
        unidadFisicaId: u.id,
        devuelto: false,
      });
    }
  }

  // 3) Las salidas sueltas del modelo viejo (`SALIDA`) no cambiaban el estado
  //    del equipo; se conservan como historial de ajuste para no inventar bajas.
  for (const m of movViejos) {
    if (m.tipo !== "SALIDA" || !unidadById.has(m.deviceId ?? "")) continue;
    movimiento(
      m.id!,
      {
        tipo: "AJUSTE_SALIDA",
        fecha: m.createdAt,
        usuarioId: m.userId,
        responsableId: null,
        departamentoId: m.departmentId,
        motivo: clean(m.notas) ?? "Salida de material",
        observaciones: null,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      },
      [m.deviceId!]
    );
  }

  write("movimientos", movimientos);
  write("movimiento_detalles", movDetalles);
  write("movimiento_detalle_unidades", movDetalleUnidades);
  write("prestamos", prestamos);
  write("prestamo_detalles", prestamoDetalles);
  write("prestamo_detalle_unidades", prestamoDetalleUnidades);

  write(
    "material_outputs",
    rows("material_outputs").map((o) => ({
      id: o.id,
      fecha: o.fecha,
      descripcion: o.descripcion,
      modelo: o.modelo,
      marca: o.marca,
      proyecto: o.proyecto,
      cantidad: int(o.cantidad),
      departamento: o.departamento,
      usuario: o.usuario,
      observaciones: o.observaciones,
      area: o.area ?? "Sistemas",
      motivo: o.motivo,
      unidadFisicaId: unidadById.has(o.deviceId ?? "") ? o.deviceId : null,
      registradoPorId: o.registradoPorId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }))
  );

  // `device_history` desaparece como tabla; su rastro se conserva en la
  // bitácora de auditoría, que sí sobrevive y ya indexa por equipo.
  const auditoria = rows("audit_logs").map((a) => ({
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    userId: a.userId,
    userName: nombreDe(a.userId) ?? a.userName,
    deviceId: a.deviceId,
    deviceCode: a.deviceCode,
    previousState: json(a.previousState),
    newState: json(a.newState),
    metadata: json(a.metadata),
    createdAt: a.createdAt,
  }));

  for (const h of rows("device_history")) {
    const u = unidadById.get(h.deviceId ?? "");
    auditoria.push({
      id: h.id,
      action: `DEVICE_${h.type}`,
      entityType: "UnidadFisica",
      entityId: h.deviceId,
      userId: h.autorId,
      userName: nombreDe(h.autorId),
      deviceId: h.deviceId,
      deviceCode: u?.activoFijo ?? null,
      previousState: null,
      newState: null,
      metadata: { detail: h.detail, origen: "device_history" },
      createdAt: h.createdAt,
    });
  }
  auditoria.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  write("audit_logs", auditoria);

  // Fixtures del modelo viejo que ya no existen en el esquema nuevo.
  for (const obsoleto of [
    "devices",
    "device_types",
    "device_history",
    "cartas_responsivas",
    "carta_items",
    "inventory_movements",
  ]) {
    const file = path.join(OUT, `${obsoleto}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  if (avisos.length > 0) {
    console.log("\nNombres que no siguen la convención del username (revisar):");
    for (const a of avisos) console.log(`  ! ${a}`);
  }

  console.log(
    `\nEquipos: ${devices.length} unidades físicas en ${Object.keys(dispositivos).length} dispositivos.` +
      `\nCartas responsivas: ${prestamos.length} préstamos activos.` +
      `\nMovimientos reconstruidos: ${movimientos.length}.`
  );
}

main();
