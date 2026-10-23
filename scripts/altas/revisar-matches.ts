/**
 * Revisa las personas MATCH del cruce (reloj vs Lista de Empleados) contra el sistema:
 * si ya tienen usuario, carta responsiva activa (préstamo ACTIVE/PARTIAL a su nombre),
 * tickets abiertos (creados o asignados) y tareas pendientes.
 *
 * SOLO LEE la base: no crea, no cambia ni borra nada.
 *
 * Uso (desde la carpeta api/, con DATABASE_URL en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/revisar-matches.ts <cruce.xlsx> <salida.xlsx>
 */
import * as path from "path";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";

type CruceRow = {
  numero: string;
  primerNombre: string;
  segundoNombre: string;
  paterno: string;
  materno: string;
  departamento: string;
  puesto: string;
  username: string;
  estado: string;
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

const readCruce = (file: string): CruceRow[] => {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets["Cruce"];
  if (!sheet) throw new Error('El archivo no tiene la hoja "Cruce"');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((r) => ({
    numero: String(r["Numero empleado (reloj)"] ?? "").trim(),
    primerNombre: String(r["Primer nombre"] ?? "").trim(),
    segundoNombre: String(r["Segundo nombre"] ?? "").trim(),
    paterno: String(r["Apellido paterno"] ?? "").trim(),
    materno: String(r["Apellido materno"] ?? "").trim(),
    departamento: String(r["Departamento"] ?? "").trim(),
    puesto: String(r["Puesto"] ?? "").trim(),
    username: String(r["Username"] ?? "").trim(),
    estado: String(r["Estado"] ?? "").trim(),
  }));
};

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Uso: revisar-matches.ts <cruce.xlsx> <salida.xlsx>");
    process.exit(1);
  }

  const matches = readCruce(input).filter((r) => r.estado === "MATCH");
  const users = await prismaClient.user.findMany({
    select: { id: true, username: true, name: true, employeeNumber: true, active: true, role: true },
  });
  const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const byNumber = new Map(users.filter((u) => u.employeeNumber).map((u) => [u.employeeNumber as string, u]));
  const byName = new Map<string, (typeof users)[number]>();
  for (const u of users) byName.set(norm(u.name), u);

  const report: Record<string, unknown>[] = [];
  let withUser = 0;
  let withLetter = 0;
  let withOpenTickets = 0;
  let withTasks = 0;

  for (const row of matches) {
    const fullName = [row.primerNombre, row.segundoNombre, row.paterno, row.materno].filter(Boolean).join(" ");
    // Buscamos al usuario por nombre de usuario, por número y por nombre completo (en ese orden).
    const found =
      byUsername.get(row.username.toLowerCase()) ??
      byNumber.get(row.numero) ??
      byName.get(norm(fullName));
    const how = found
      ? byUsername.get(row.username.toLowerCase()) === found
        ? "nombre de usuario"
        : byNumber.get(row.numero) === found
          ? "numero de empleado"
          : "nombre completo"
      : "";

    let letters: string[] = [];
    let openCreated = 0;
    let openAssigned = 0;
    let pendingTasks = 0;
    if (found) {
      withUser++;
      const loans = await prismaClient.loan.findMany({
        where: { custodianId: found.id, status: { in: ["ACTIVE", "PARTIAL"] } },
        select: { number: true },
      });
      letters = loans.map((l) => l.number);
      openCreated = await prismaClient.ticket.count({ where: { createdById: found.id, status: { not: "CLOSED" } } });
      openAssigned = await prismaClient.ticket.count({ where: { assignedToId: found.id, status: { not: "CLOSED" } } });
      pendingTasks = await prismaClient.ticketAssignment.count({ where: { userId: found.id, status: { not: "COMPLETED" } } });
      if (letters.length) withLetter++;
      if (openCreated + openAssigned > 0) withOpenTickets++;
      if (pendingTasks > 0) withTasks++;
    }

    const notes: string[] = [];
    if (found && !found.active) notes.push("usuario desactivado");
    if (found && found.username !== row.username) notes.push(`username actual ${found.username} (nuevo: ${row.username})`);
    if (found && found.employeeNumber && found.employeeNumber !== row.numero) notes.push(`numero actual ${found.employeeNumber} (reloj: ${row.numero})`);

    report.push({
      "Numero (reloj)": row.numero,
      "Username nuevo": row.username,
      Nombre: fullName,
      Departamento: row.departamento,
      Puesto: row.puesto,
      "Usuario en sistema": found ? found.username : "",
      "Encontrado por": how,
      "Cartas responsivas activas": letters.length,
      "Numeros de carta": letters.join(", "),
      "Tickets abiertos (creados)": openCreated,
      "Tickets abiertos (asignados)": openAssigned,
      "Tareas pendientes": pendingTasks,
      Observacion: notes.join("; "),
    });
  }

  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(report), "Revision");
  XLSX.writeFile(out, path.resolve(output));

  console.log(`MATCH revisados: ${matches.length}`);
  console.log(`con usuario en el sistema: ${withUser}`);
  console.log(`con carta responsiva activa: ${withLetter}`);
  console.log(`con tickets abiertos: ${withOpenTickets}`);
  console.log(`con tareas pendientes: ${withTasks}`);
  console.log(`archivo: ${path.resolve(output)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
