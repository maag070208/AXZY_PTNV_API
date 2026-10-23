/**
 * Cambia el nombre de usuario de las cuentas que ya existen, al username del cruce
 * (p. ej. MarcoH -> marco.herrera). La cuenta NO se borra ni se recrea: conserva su id,
 * así todo lo que tiene (cartas responsivas, tickets, tareas, historial) queda en el nuevo username.
 * El username viejo deja de servir porque ya no existe.
 *
 * Por defecto NO escribe nada (dry-run). Para aplicar, agrega --apply.
 *
 * Uso (desde la carpeta api/, con DATABASE_URL en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/renombrar-usuarios.ts <cruce.xlsx> <reporte.xlsx>
 *   npx ts-node -r tsconfig-paths/register scripts/altas/renombrar-usuarios.ts <cruce.xlsx> <reporte.xlsx> --apply
 */
import * as path from "path";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";

type CruceRow = { numero: string; excelNumero: string; nombre: string; username: string; estado: string };

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
  const sheet = XLSX.readFile(file).Sheets["Cruce"];
  if (!sheet) throw new Error('El archivo no tiene la hoja "Cruce"');
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).map((r) => {
    const nombre = [r["Primer nombre"], r["Segundo nombre"], r["Apellido paterno"], r["Apellido materno"]]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(" ");
    return {
      numero: String(r["Numero empleado (reloj)"] ?? "").trim(),
      excelNumero: String(r["Numero en Excel"] ?? "").trim(),
      nombre,
      username: String(r["Username"] ?? "").trim(),
      estado: String(r["Estado"] ?? "").trim(),
    };
  });
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [input, output] = args.filter((a) => !a.startsWith("--"));
  if (!input || !output) {
    console.error("Uso: renombrar-usuarios.ts <cruce.xlsx> <reporte.xlsx> [--apply]");
    process.exit(1);
  }

  const cruce = readCruce(input);
  const users = await prismaClient.user.findMany({
    select: { id: true, username: true, name: true, employeeNumber: true, active: true },
  });
  const byName = new Map<string, (typeof users)[number]>();
  for (const u of users) byName.set(norm(u.name), u);
  const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));

  type Plan = { user: (typeof users)[number]; from: string; to: string; row: CruceRow; motivo: string; resultado: string };
  const plans: Plan[] = [];
  const sinCambio: Record<string, unknown>[] = [];
  const claimed = new Set<string>();
  const claimedUsers = new Set<string>();

  for (const row of cruce) {
    // Cuenta existente: por nombre completo (sin orden ni acentos). Solo por nombre: el numero del Excel
    // se repite entre departamentos y no sirve para identificar a nadie.
    const user = byName.get(norm(row.nombre));
    const motivo = "nombre completo";
    if (!user) continue;
    if (user.username === row.username) {
      sinCambio.push({ "Username actual": user.username, "Username nuevo": row.username, Nombre: user.name, Resultado: "ya tiene ese username" });
      continue;
    }
    const taken = byUsername.get(row.username.toLowerCase());
    let resultado = "listo";
    if (taken && taken.id !== user.id) resultado = `CONFLICTO: ${row.username} ya lo usa otra cuenta (${taken.name})`;
    else if (claimed.has(row.username.toLowerCase())) resultado = `CONFLICTO: ${row.username} lo pide mas de una fila del cruce`;
    else if (claimedUsers.has(user.id)) resultado = "CONFLICTO: la misma cuenta aparece en mas de una fila del cruce";
    claimed.add(row.username.toLowerCase());
    claimedUsers.add(user.id);
    plans.push({ user, from: user.username, to: row.username, row, motivo, resultado });
  }

  let renamed = 0;
  if (apply) {
    for (const p of plans) {
      if (p.resultado !== "listo") continue;
      await prismaClient.$transaction(async (tx) => {
        await tx.user.update({ where: { id: p.user.id }, data: { username: p.to } });
        await tx.auditLog.create({
          data: {
            action: "USER_USERNAME_CHANGED",
            entityType: "User",
            entityId: p.user.id,
            userName: "script renombrar-usuarios",
            previousState: { username: p.from },
            newState: { username: p.to },
            metadata: { motivo: p.motivo, employeeNumber: p.user.employeeNumber, numeroReloj: p.row.numero },
          },
        });
      });
      p.resultado = "renombrado";
      renamed++;
    }
  }

  const report = [
    ...plans.map((p) => ({
      "Username actual": p.from,
      "Username nuevo": p.to,
      Nombre: p.user.name,
      "Nombre en cruce": p.row.nombre,
      "Numero en sistema": p.user.employeeNumber ?? "",
      "Encontrado por": p.motivo,
      Resultado: apply && p.resultado === "renombrado" ? "renombrado" : p.resultado,
    })),
    ...sinCambio,
  ];
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(report.length ? report : [{ Resultado: "sin cambios" }]), "Renombrar");
  XLSX.writeFile(out, path.resolve(output));

  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply para aplicar)");
  console.log(`cuentas a renombrar: ${plans.filter((p) => p.resultado === "listo" || p.resultado === "renombrado").length}`);
  console.log(`conflictos: ${plans.filter((p) => p.resultado.startsWith("CONFLICTO")).length}`);
  console.log(`ya tenian el username: ${sinCambio.length}`);
  if (apply) console.log(`renombradas: ${renamed}`);
  console.log(`reporte: ${path.resolve(output)}`);
  for (const p of plans) console.log(`  ${p.from} -> ${p.to}  (${p.user.name})  ${p.resultado}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
