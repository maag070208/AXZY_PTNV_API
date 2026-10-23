/**
 * Vincula cada cuenta con su numero de empleado del reloj (tabla time_clock_employees).
 * Sin este vinculo el inicio dice "Tu numero del reloj no esta vinculado" y el padron no
 * sabe que la persona es la misma. Solo escribe el vinculo; no toca el reloj.
 *
 * Solo vincula cuentas cuyo employeeNumber coincide con el numero del cruce, y no pisa
 * vinculos que ya existan apuntando a otra cuenta.
 *
 * Por defecto NO escribe nada. Agrega --apply para aplicar.
 *
 * Uso (desde api/): npx ts-node -r tsconfig-paths/register scripts/altas/vincular-reloj.ts <cruce.xlsx> [--apply]
 */
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [input] = args.filter((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Uso: vincular-reloj.ts <cruce.xlsx> [--apply]");
    process.exit(1);
  }
  const sheet = XLSX.readFile(input).Sheets["Cruce"];
  const numbers = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
    .map((r) => String(r["Numero empleado (reloj)"] ?? "").trim())
    .filter(Boolean);

  const users = await prismaClient.user.findMany({
    where: { employeeNumber: { in: numbers } },
    select: { id: true, username: true, employeeNumber: true },
  });
  const existing = await prismaClient.timeClockEmployee.findMany({ select: { employeeNumber: true, userId: true } });
  const linkedTo = new Map(existing.map((l) => [l.employeeNumber, l.userId]));

  const toCreate = users.filter((u) => !linkedTo.has(u.employeeNumber as string));
  const alreadyOk = users.length - toCreate.length;
  const conflicts = users.filter((u) => linkedTo.has(u.employeeNumber as string) && linkedTo.get(u.employeeNumber as string) !== u.id);

  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply)");
  console.log(`cuentas con numero del cruce: ${users.length}`);
  console.log(`ya vinculadas: ${alreadyOk}`);
  console.log(`por vincular: ${toCreate.length}`);
  console.log(`conflictos (numero ligado a otra cuenta): ${conflicts.length}`);
  for (const c of conflicts) console.log(`  CONFLICTO ${c.username} ${c.employeeNumber}`);
  if (!apply) return;

  await prismaClient.$transaction(async (tx) => {
    for (const u of toCreate) {
      await tx.timeClockEmployee.create({ data: { employeeNumber: u.employeeNumber as string, userId: u.id, status: "ACTIVO" } });
    }
    await tx.auditLog.create({
      data: {
        action: "TIME_CLOCK_EMPLOYEE_LINKED_BULK",
        entityType: "TimeClockEmployee",
        entityId: "bulk",
        userName: "script vincular-reloj",
        metadata: { vinculados: toCreate.length, numeros: toCreate.map((u) => u.employeeNumber) },
      },
    });
  });
  console.log(`vinculadas: ${toCreate.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
