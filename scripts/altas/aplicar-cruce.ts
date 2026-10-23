/**
 * Carga el cruce del reloj en el sistema: actualiza las cuentas que ya existen
 * (mismo id, así que cartas, tickets y tareas siguen siendo suyas) y crea las
 * que faltan. Deja la contraseña provisional `123456` y la marca para cambiarla
 * al entrar. Vincula el número del reloj.
 *
 * Por defecto NO escribe nada (dry-run). Para aplicar, agrega --apply.
 *
 * Uso (desde api/, con DATABASE_URL en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/aplicar-cruce.ts <cruce.xlsx> [--apply] [--numbers=020804,020886]
 */
import path from "node:path";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

const INITIAL_PASSWORD = "123456";

type Row = {
  number: string;
  action: string;
  name: string;
  middleName: string;
  paternalSurname: string;
  maternalSurname: string;
  username: string;
  currentUsername: string;
};

const readRows = (file: string): Row[] => {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets["Cruce final"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("El archivo no tiene hojas");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((r) => {
    const s = (k: string) => String(r[k] ?? "").trim();
    return {
      number: s("Numero reloj"),
      action: s("Accion"),
      name: s("Nombre(s)"),
      middleName: s("Segundo nombre"),
      paternalSurname: s("Apellido paterno"),
      maternalSurname: s("Apellido materno"),
      username: s("Username nuevo"),
      currentUsername: s("Usuario actual"),
    };
  });
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const numbersArg = args.find((a) => a.startsWith("--numbers="))?.split("=")[1];
  const only = numbersArg ? new Set(numbersArg.split(",").map((n) => n.trim())) : null;
  const [file] = args.filter((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Uso: aplicar-cruce.ts <cruce.xlsx> [--apply] [--numbers=...]");
    process.exit(1);
  }

  const all = readRows(path.resolve(file));
  const rows = only ? all.filter((r) => only.has(r.number)) : all;
  if (only && rows.length !== only.size) {
    const found = new Set(rows.map((r) => r.number));
    throw new Error(`No están en el archivo: ${[...only].filter((n) => !found.has(n)).join(", ")}`);
  }

  const users = await prismaClient.user.findMany({
    select: { id: true, username: true, name: true, middleName: true, paternalSurname: true, maternalSurname: true, employeeNumber: true },
  });
  const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const byNumber = new Map(users.filter((u) => u.employeeNumber).map((u) => [u.employeeNumber as string, u]));

  type Plan = { row: Row; kind: "update" | "create" | "skip"; userId?: string; previous?: unknown };
  const plan: Plan[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.name || !row.paternalSurname) {
      errors.push(`${row.number}: falta nombre o apellido paterno`);
      continue;
    }
    const target = byUsername.get(row.username.toLowerCase());
    if (target) {
      // Ya se aplicó antes: no se toca.
      plan.push({ row, kind: "skip", userId: target.id });
      continue;
    }
    if (row.action === "ACTUALIZA") {
      const current = byUsername.get(row.currentUsername.toLowerCase());
      if (!current) {
        errors.push(`${row.number}: no encontré la cuenta "${row.currentUsername}"`);
        continue;
      }
      const numberOwner = byNumber.get(row.number);
      if (numberOwner && numberOwner.id !== current.id) {
        errors.push(`${row.number}: el número ya lo tiene ${numberOwner.username}`);
        continue;
      }
      plan.push({ row, kind: "update", userId: current.id, previous: current });
    } else {
      const numberOwner = byNumber.get(row.number);
      if (numberOwner) {
        errors.push(`${row.number}: el número ya lo tiene ${numberOwner.username}`);
        continue;
      }
      plan.push({ row, kind: "create" });
    }
  }

  const shown = plan.map((p) => ({
    numero: p.row.number,
    accion: p.kind,
    username: p.row.username,
    nombre: [p.row.name, p.row.middleName, p.row.paternalSurname, p.row.maternalSurname].filter(Boolean).join(" "),
    anterior: p.kind === "update" ? p.row.currentUsername : "",
  }));
  console.table(shown);
  if (errors.length) {
    console.error("\nERRORES:");
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
  console.log(apply ? "\nMODO APLICAR" : "\nDRY-RUN (no se escribió nada; agrega --apply)");
  if (!apply) return;

  const hash = await hashPassword(INITIAL_PASSWORD);
  let updated = 0;
  let created = 0;
  await prismaClient.$transaction(async (tx) => {
    for (const p of plan) {
      if (p.kind === "skip") continue;
      const data = {
        username: p.row.username,
        name: p.row.name,
        middleName: p.row.middleName || null,
        paternalSurname: p.row.paternalSurname,
        maternalSurname: p.row.maternalSurname || null,
        employeeNumber: p.row.number,
        password: hash,
        mustChangePassword: true,
      };
      if (p.kind === "update") {
        await tx.user.update({ where: { id: p.userId! }, data });
        updated++;
      } else {
        const user = await tx.user.create({ data: { ...data, role: "EMPLOYEE", active: true } });
        p.userId = user.id;
        created++;
      }
      await tx.timeClockEmployee.upsert({
        where: { employeeNumber: p.row.number },
        create: { employeeNumber: p.row.number, userId: p.userId! },
        update: { userId: p.userId! },
      });
      await tx.auditLog.create({
        data: {
          action: p.kind === "update" ? "USER_SYNC_UPDATED" : "USER_SYNC_CREATED",
          entityType: "User",
          entityId: p.userId!,
          userName: "script aplicar-cruce",
          previousState: (p.previous as object) ?? undefined,
          newState: { username: p.row.username, name: p.row.name, employeeNumber: p.row.number, mustChangePassword: true },
          metadata: { origen: "cruce reloj", numeroReloj: p.row.number, contrasenaInicial: true },
        },
      });
    }
  });
  console.log(`\nlisto: ${updated} actualizados, ${created} creados, ${plan.length - updated - created} sin cambio`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
