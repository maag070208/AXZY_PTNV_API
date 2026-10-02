/**
 * Carga un respaldo PRODUCTIVO del cliente en la base de datos apuntada por
 * `DATABASE_URL`, en un solo paso.
 *
 * Uso:  npm run restore -- <ruta/al/respaldo.dump> [opciones]
 *
 *   --yes             Autoriza una base que NO es local (producción). Sin esto,
 *                     el comando se niega a tocar una base remota.
 *   --fixtures        Además de restaurar, regenera los fixtures de
 *                     `prisma/seed-data/` con el mismo respaldo (lo que hace
 *                     `npm run seed:from-backup`).
 *   --no-reconcile    No corre la conciliación de inventario al terminar.
 *   --container=NAME  Contenedor de Postgres (por omisión `cartas-postgres`).
 *
 * Qué hace, en orden:
 *   1. Convierte el dump custom a SQL plano si hace falta.
 *   2. Vacía el esquema `public` y lo restaura del respaldo, tal cual: la base
 *      queda EXACTAMENTE como el respaldo (esquema y datos), no mezclada.
 *   3. `prisma migrate deploy`: pone al día las migraciones que el respaldo no
 *      traía (el respaldo suele venir de una versión anterior).
 *   4. Concilia el inventario (liga las unidades de las altas que el respaldo
 *      trae sueltas) y corre el auditor: si algo no cuadra, lo dice.
 *
 * El API debe estar detenido (o se reinicia al terminar): durante la carga la
 * base no tiene el esquema esperado por el código en ejecución.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { commandExists, pgContainer, run, toPlainSql } from "./legacy/dump";
import { reconcileInventory } from "./reconcile-inventory";
import { ensureGenericDeviceType } from "../src/modules/inventory/services/generic-type";
import { InventoryAuditService } from "../src/modules/inventory/services/inventory-audit.service";

const USAGE = `Uso: npm run restore -- <respaldo.dump|backup.sql> [--yes] [--fixtures] [--no-reconcile] [--container=NAME]`;

interface Target {
  user: string;
  password: string;
  database: string;
  host: string;
  port: string;
  url: string;
}

const mask = (url: string): string => url.replace(/:\/\/([^:]*):[^@]*@/, "://$1:***@");

function parseTarget(url: string): Target {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    host: parsed.hostname,
    port: parsed.port || "5432",
    url,
  };
}

const isLocal = (target: Target): boolean =>
  /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal)$/.test(target.host);

/**
 * Arma la invocación de `psql` contra la base destino: se usa el `psql` local si
 * existe y, si no, el del contenedor de Postgres (conectándose a su propio
 * puerto interno, que no es el que publica docker-compose).
 */
async function psqlInvocation(target: Target): Promise<{ command: string; args: string[] }> {
  if (await commandExists("psql")) {
    return { command: "psql", args: [target.url] };
  }
  if (await commandExists("docker")) {
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        `PGPASSWORD=${target.password}`,
        pgContainer(),
        "psql",
        "-h",
        "127.0.0.1",
        "-p",
        "5432",
        "-U",
        target.user,
        "-d",
        target.database,
      ],
    };
  }
  throw new Error(
    "No encontré `psql` ni `docker` para hablar con la base.\n" +
      "Instala el cliente de PostgreSQL o corre este comando donde esté el contenedor."
  );
}

const sqlArgs = (base: { command: string; args: string[] }, extra: string[]) => ({
  command: base.command,
  args: [...base.args, "-v", "ON_ERROR_STOP=1", ...extra],
});

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const container = argv.find((a) => a.startsWith("--container="))?.split("=")[1];
  const file = argv.find((a) => !a.startsWith("--"));

  if (!file) {
    console.error(USAGE);
    process.exit(1);
  }
  if (container) process.env.PG_CONTAINER = container;

  const source = path.resolve(file);
  if (!fs.existsSync(source)) throw new Error(`No existe el respaldo: ${source}`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (revisa api/.env)");
  const target = parseTarget(url);

  const remote = !isLocal(target);
  if (remote && !flags.has("--yes") && process.env.RESTORE_ALLOW_REMOTE !== "1") {
    throw new Error(
      `La base destino NO es local (${mask(url)}).\n` +
        `Este comando VACÍA esa base y la reemplaza con el respaldo.\n` +
        `Si es lo que quieres, repítelo agregando --yes.`
    );
  }

  console.log(`Respaldo : ${source} (${(fs.statSync(source).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Destino  : ${mask(url)}${remote ? "  ← BASE REMOTA" : ""}`);
  console.log("");
  console.log("El API debe estar detenido: durante la carga la base no tiene el esquema que espera.");
  console.log("");

  // 1) SQL plano -------------------------------------------------------------
  const sqlFile = await toPlainSql(source);
  if (sqlFile !== source) console.log("• Dump custom convertido a SQL plano");
  else console.log("• El respaldo ya es SQL plano");

  const psql = await psqlInvocation(target);

  // 2) Reemplazo del esquema -------------------------------------------------
  console.log("• Vaciando el esquema public…");
  await run(
    psql.command,
    sqlArgs(psql, ["-c", "DROP SCHEMA IF EXISTS public CASCADE", "-c", "CREATE SCHEMA public"]).args
  );

  console.log("• Restaurando el respaldo…");
  await run(
    psql.command,
    sqlArgs(psql, ["-q", "-f", "-"]).args,
    { input: fs.createReadStream(sqlFile) }
  );

  // 3) Migraciones -----------------------------------------------------------
  console.log("• Aplicando migraciones pendientes (prisma migrate deploy)…");
  await run("npx", ["prisma", "migrate", "deploy"]);

  // 4) Catálogos del sistema, conciliación y auditoría -----------------------
  const db = new PrismaClient();
  try {
    // El respaldo trae el catálogo del cliente; el tipo GENÉRICO lo necesita la
    // carga masiva por Excel y es del sistema (insert-missing, sin pisar nada).
    const generic = await ensureGenericDeviceType(db);
    console.log(`• Tipo genérico listo: ${generic.name} (${generic.assetTagPrefix})`);

    if (!flags.has("--no-reconcile")) {
      const report = await reconcileInventory(db);
      console.log(
        `• Inventario conciliado: ${report.adjusted.length} kardex ajustados, ` +
          `${report.linkedUnits.length} renglones con unidades ligadas, ` +
          `${report.unresolved.length} sin resolver`
      );
    }
    const audit = await new InventoryAuditService(db, {
      createManyNotifications: async () => {},
    }).run();
    const failing = audit.checks.filter((c) => c.count > 0);
    console.log("");
    console.log(audit.ok ? "Auditoría del inventario: OK (8/8 reglas en verde)" : "Auditoría del inventario: revisar");
    for (const check of failing) {
      console.log(`  ✗ ${check.key}: ${check.count} — ${check.samples.slice(0, 3).join(" | ")}`);
    }

    const [users, devices, units, loans] = await Promise.all([
      db.user.count(),
      db.device.count(),
      db.deviceUnit.count(),
      db.loan.count(),
    ]);
    console.log("");
    console.log(`Base cargada: ${users} usuarios, ${devices} dispositivos, ${units} unidades, ${loans} cartas`);
  } finally {
    await db.$disconnect();
  }

  // 5) Fixtures (opcional) ---------------------------------------------------
  if (flags.has("--fixtures")) {
    console.log("• Actualizando los fixtures de prisma/seed-data…");
    await run("npm", ["run", "seed:from-backup", "--", source]);
  }

  console.log("");
  console.log("Listo. Reinicia el API para que trabaje con los datos cargados.");
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
