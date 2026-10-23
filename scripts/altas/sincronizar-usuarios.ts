/**
 * Alinea las cuentas del sistema con el cruce (reloj = fuente de verdad del numero de empleado):
 *  - numero de empleado = numero del reloj
 *  - username = el del cruce (nombre.apellido)
 *  - puesto (jobTitle) y departamento (si el nombre existe en el catalogo)
 * Las cuentas se ACTUALIZAN, no se borran: conservan su id, asi que cartas, tickets y
 * movimientos siguen ligados a la misma persona.
 *
 * Con --crear da de alta a las personas del cruce que no tienen cuenta (sin acceso hasta
 * que RH defina contrasena: se guarda un hash aleatorio).
 *
 * Por defecto NO escribe nada (dry-run). Para aplicar agrega --apply.
 *
 * Uso (desde api/, con DATABASE_URL en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/sincronizar-usuarios.ts <cruce.xlsx> <reporte.xlsx> [--crear] [--apply]
 */
import * as path from "path";
import { randomBytes } from "crypto";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

/** Departamento del Excel -> nombre del catalogo del sistema. Lo que no esta aqui se deja vacio y se reporta. */
const DEPT_MAP: Record<string, string> = {
  RECEPCION: "RECEPCION",
  RESERVACIONES: "RESERVACIONES",
  ALMACEN: "ALMACEN",
  CABALLERIZAS: "CABALLERIZAS",
  MANTENIMIENTO: "MANTENIMIENTO",
  "EVENTOS Y BODAS": "BODAS",
  "LA VID SPA": "SPA",
};

const norm = (text: unknown): string =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z ]/g, " ")
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

type Row = { numero: string; nombre: string; paterno: string; materno: string; nombreCompleto: string; depto: string; puesto: string; username: string; estado: string };

const readCruce = (file: string): Row[] => {
  const sheet = XLSX.readFile(file).Sheets["Cruce"];
  if (!sheet) throw new Error('El archivo no tiene la hoja "Cruce"');
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).map((r) => {
    const s = (k: string) => String(r[k] ?? "").trim();
    const nombreCompleto = [s("Primer nombre"), s("Segundo nombre"), s("Apellido paterno"), s("Apellido materno")].filter(Boolean).join(" ");
    return {
      numero: s("Numero empleado (reloj)"),
      nombre: [s("Primer nombre"), s("Segundo nombre")].filter(Boolean).join(" "),
      paterno: s("Apellido paterno"),
      materno: s("Apellido materno"),
      nombreCompleto,
      depto: s("Departamento"),
      puesto: s("Puesto"),
      username: s("Username"),
      estado: s("Estado"),
    };
  });
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const crear = args.includes("--crear");
  const [input, output] = args.filter((a) => !a.startsWith("--"));
  if (!input || !output) {
    console.error("Uso: sincronizar-usuarios.ts <cruce.xlsx> <reporte.xlsx> [--crear] [--apply]");
    process.exit(1);
  }

  const rows = readCruce(input);
  const users = await prismaClient.user.findMany({
    select: { id: true, username: true, name: true, employeeNumber: true, jobTitle: true, departmentId: true, active: true },
  });
  const departments = await prismaClient.department.findMany({ select: { id: true, name: true } });
  const deptByName = new Map(departments.map((d) => [d.name.toUpperCase(), d.id]));
  const byName = new Map<string, (typeof users)[number]>();
  for (const u of users) byName.set(norm(u.name), u);

  const report: Record<string, unknown>[] = [];
  const planned: Array<{ kind: "update" | "create"; userId?: string; data: Record<string, unknown>; label: string; before: unknown }> = [];
  const numberOwner = new Map(users.filter((u) => u.employeeNumber).map((u) => [u.employeeNumber as string, u.id]));
  const usernameOwner = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
  const seenNumbers = new Set<string>();
  const seenUsernames = new Set<string>();

  for (const row of rows) {
    const deptName = DEPT_MAP[row.depto] ?? "";
    const deptId = deptName ? deptByName.get(deptName) ?? null : null;
    const existing = byName.get(norm(row.nombreCompleto));
    const issues: string[] = [];
    if (row.depto && !deptName) issues.push(`departamento sin equivalente en el catalogo: ${row.depto}`);
    if (row.depto && deptName && !deptId) issues.push(`departamento ${deptName} no existe en el catalogo`);
    if (!row.numero) issues.push("sin numero de reloj");

    if (existing) {
      const data: Record<string, unknown> = {};
      if (row.numero && existing.employeeNumber !== row.numero) data.employeeNumber = row.numero;
      if (row.username && existing.username !== row.username) data.username = row.username;
      if (row.puesto && existing.jobTitle !== row.puesto) data.jobTitle = row.puesto;
      if (deptId && existing.departmentId !== deptId) data.departmentId = deptId;
      if (data.employeeNumber && numberOwner.has(row.numero) && numberOwner.get(row.numero) !== existing.id) issues.push(`CONFLICTO: el numero ${row.numero} ya lo tiene otra cuenta`);
      if (data.username && usernameOwner.has(row.username.toLowerCase()) && usernameOwner.get(row.username.toLowerCase()) !== existing.id) issues.push(`CONFLICTO: el username ${row.username} ya lo usa otra cuenta`);
      if (row.numero && seenNumbers.has(row.numero)) issues.push("CONFLICTO: numero repetido en el cruce");
      if (row.username && seenUsernames.has(row.username.toLowerCase())) issues.push("CONFLICTO: username repetido en el cruce");
      seenNumbers.add(row.numero);
      seenUsernames.add(row.username.toLowerCase());
      const conflict = issues.some((i) => i.startsWith("CONFLICTO"));
      if (Object.keys(data).length && !conflict) planned.push({ kind: "update", userId: existing.id, data, label: `${existing.username} -> ${row.username}`, before: { username: existing.username, employeeNumber: existing.employeeNumber, jobTitle: existing.jobTitle } });
      report.push({
        Accion: conflict ? "CONFLICTO" : Object.keys(data).length ? "ACTUALIZAR" : "sin cambios",
        "Username actual": existing.username,
        "Username nuevo": row.username,
        "Numero actual": existing.employeeNumber ?? "",
        "Numero nuevo (reloj)": row.numero,
        Nombre: row.nombreCompleto,
        Departamento: deptName,
        Puesto: row.puesto,
        Observacion: issues.join("; "),
      });
    } else {
      const conflict = (numberOwner.has(row.numero) && row.numero) || (usernameOwner.has(row.username.toLowerCase()) && row.username) ? true : false;
      if (conflict) issues.push("CONFLICTO: numero o username ya existe en otra cuenta");
      if (row.numero && seenNumbers.has(row.numero)) issues.push("CONFLICTO: numero repetido en el cruce");
      seenNumbers.add(row.numero);
      seenUsernames.add(row.username.toLowerCase());
      const bad = issues.some((i) => i.startsWith("CONFLICTO"));
      if (crear && !bad) planned.push({ kind: "create", data: { username: row.username, name: row.nombreCompleto, employeeNumber: row.numero, jobTitle: row.puesto || null, departmentId: deptId, role: "EMPLOYEE", active: true }, label: `nuevo ${row.username}`, before: null });
      report.push({
        Accion: bad ? "CONFLICTO" : crear ? "CREAR" : "sin cuenta (usa --crear)",
        "Username actual": "",
        "Username nuevo": row.username,
        "Numero actual": "",
        "Numero nuevo (reloj)": row.numero,
        Nombre: row.nombreCompleto,
        Departamento: deptName,
        Puesto: row.puesto,
        Observacion: issues.join("; "),
      });
    }
  }

  let done = 0;
  if (apply) {
    for (const p of planned) {
      await prismaClient.$transaction(async (tx) => {
        if (p.kind === "create") {
          const password = await hashPassword(randomBytes(24).toString("hex"));
          const created = await tx.user.create({ data: { ...(p.data as any), password } });
          await tx.auditLog.create({ data: { action: "USER_SYNC_CREATED", entityType: "User", entityId: created.id, userName: "script sincronizar-usuarios", newState: p.data as any, metadata: { origen: "cruce reloj" } } });
        } else {
          await tx.user.update({ where: { id: p.userId! }, data: p.data as any });
          await tx.auditLog.create({ data: { action: "USER_SYNC_UPDATED", entityType: "User", entityId: p.userId!, userName: "script sincronizar-usuarios", previousState: p.before as any, newState: p.data as any, metadata: { origen: "cruce reloj" } } });
        }
      });
      done++;
    }
  }

  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(report), "Sincronizar");
  XLSX.writeFile(out, path.resolve(output));
  const conflicts = report.filter((r) => r.Accion === "CONFLICTO").length;
  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply)");
  console.log(`cambios planeados: ${planned.length} (actualizar ${planned.filter((p) => p.kind === "update").length}, crear ${planned.filter((p) => p.kind === "create").length})`);
  console.log(`conflictos: ${conflicts}`);
  if (apply) console.log(`aplicados: ${done}`);
  console.log(`reporte: ${path.resolve(output)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
