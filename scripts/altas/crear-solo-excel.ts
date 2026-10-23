/**
 * Da de alta a las personas del Excel que NO estan en el reloj (hoja "Altas" de altas-solo-excel.xlsx).
 * Sin numero de empleado (no hay numero del reloj todavia). Lo que no tiene dato va como "N/A".
 * Contrasena inicial: 123456 (se marca en la bitacora). Solo crea; no toca cuentas existentes.
 *
 * Por defecto NO escribe nada. Agrega --apply para aplicar.
 *
 * Uso (desde api/): npx ts-node -r tsconfig-paths/register scripts/altas/crear-solo-excel.ts <altas.xlsx> [--apply]
 */
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

const INITIAL_PASSWORD = "123456";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [input] = args.filter((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Uso: crear-solo-excel.ts <altas.xlsx> [--apply]");
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.readFile(input).Sheets["Altas"], { defval: "" });
  const departments = await prismaClient.department.findMany({ select: { id: true, name: true } });
  const deptByName = new Map(departments.map((d) => [d.name.toUpperCase(), d.id]));
  const usernames = new Set((await prismaClient.user.findMany({ select: { username: true } })).map((u) => u.username.toLowerCase()));

  type Plan = { username: string; name: string; jobTitle: string; departmentId: string | null; departamentoExcel: string; numeroExcel: string };
  const plan: Plan[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const s = (k: string) => String(r[k] ?? "").trim();
    if (s("Crear") !== "SI") { skipped.push(`${s("Username")} (${s("Nombre en Excel")}): no se crea`); continue; }
    const username = s("Username");
    if (usernames.has(username.toLowerCase())) { skipped.push(`${username}: ya existe`); continue; }
    const name = [s("Primer nombre"), s("Apellido paterno"), s("Apellido materno")].filter((v) => v && v !== "N/A").join(" ");
    const deptId = s("Departamento sistema") ? deptByName.get(s("Departamento sistema").toUpperCase()) ?? null : null;
    plan.push({ username, name, jobTitle: s("Puesto") || "N/A", departmentId: deptId, departamentoExcel: s("Departamento Excel"), numeroExcel: s("Numero en Excel") });
    usernames.add(username.toLowerCase());
  }

  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply)");
  console.log(`cuentas a crear: ${plan.length}`);
  console.log(`sin crear: ${skipped.length}`);
  for (const p of plan) console.log(`  ${p.username} | ${p.name} | ${p.jobTitle} | depto: ${p.departmentId ? "catalogo" : "N/A (" + p.departamentoExcel + ")"}`);
  for (const s of skipped) console.log(`  OMITIDA ${s}`);
  if (!apply) return;

  const hash = await hashPassword(INITIAL_PASSWORD);
  await prismaClient.$transaction(async (tx) => {
    for (const p of plan) {
      const created = await tx.user.create({
        data: { username: p.username, name: p.name, jobTitle: p.jobTitle, departmentId: p.departmentId, role: "EMPLOYEE", active: true, password: hash },
      });
      await tx.auditLog.create({
        data: { action: "USER_SYNC_CREATED", entityType: "User", entityId: created.id, userName: "script crear-solo-excel", newState: { username: p.username, name: p.name, jobTitle: p.jobTitle } as Record<string, string>, metadata: { origen: "Lista Empleados 2026 (sin reloj)", departamentoExcel: p.departamentoExcel, numeroExcel: p.numeroExcel, contrasenaInicial: "123456" } as Record<string, string> },
      });
    }
  });
  console.log(`creadas: ${plan.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
