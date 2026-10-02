/**
 * Utilidades compartidas para leer un respaldo de PostgreSQL, en cualquiera de
 * las dos formas en que lo entrega el cliente:
 *
 *  - `pg_dump -Fc` (formato *custom*): empieza con la firma `PGDMP` y hay que
 *    convertirlo a SQL plano con `pg_restore`.
 *  - SQL plano (bloques `COPY ... FROM stdin`): se lee directo.
 *
 * Lo usan `refresh-seed.ts` (respaldos → fixtures) y `restore.ts` (respaldos →
 * base de datos), para que la detección del formato y la conversión sean las
 * mismas en los dos caminos.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Row = Record<string, string | null>;
export type Dump = Record<string, Row[]>;

/**
 * Contenedor de Postgres donde vive un `pg_restore`/`psql` si no hay uno local.
 * Se lee en cada uso (no al importar) para que `--container=` y `PG_CONTAINER`
 * surtan efecto en el proceso que ya está corriendo.
 */
export const pgContainer = (): string => process.env.PG_CONTAINER ?? "cartas-postgres";

/** ¿El archivo es un dump en formato custom (`pg_dump -Fc`)? */
export const isCustomDump = (file: string): boolean =>
  fs.readFileSync(file).subarray(0, 5).toString("latin1") === "PGDMP";

export const commandExists = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn("which", [command], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });

export const run = (
  command: string,
  args: string[],
  stdio: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {}
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdio.input ? "pipe" : "ignore", stdio.output ? "pipe" : "inherit", "inherit"],
    });
    child.on("error", reject);
    if (stdio.input && child.stdin) {
      stdio.input.pipe(child.stdin);
      stdio.input.on("error", reject);
    }
    if (stdio.output && child.stdout) child.stdout.pipe(stdio.output);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code}`))
    );
  });

/** Corre un comando y devuelve su salida estándar como texto. */
export const capture = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} terminó con código ${code}`))
    );
  });

/**
 * Convierte un dump *custom* a SQL plano en un archivo temporal y devuelve su
 * ruta. Si ya es SQL plano, devuelve la misma ruta.
 *
 * `pg_restore -f -` escribe el SQL en la salida estándar: se hace con `pg_restore`
 * local si existe, y si no con el que vive dentro del contenedor de Postgres
 * (el archivo viaja por stdin, no hace falta copiarlo al contenedor).
 */
export async function toPlainSql(file: string): Promise<string> {
  if (!isCustomDump(file)) return file;

  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ptnv-dump-")), "backup.sql");
  const out = fs.createWriteStream(target);
  const args = ["-f", "-", "--no-owner", "--no-privileges"];

  if (await commandExists("pg_restore")) {
    await run("pg_restore", [...args, file], { output: out });
  } else if (await commandExists("docker")) {
    await run("docker", ["exec", "-i", pgContainer(), "pg_restore", ...args], {
      input: fs.createReadStream(file),
      output: out,
    });
  } else {
    throw new Error(
      `El respaldo está en formato custom y no encontré \`pg_restore\` ni \`docker\`.\n` +
        `Conviértelo a mano y vuelve a correrlo:\n` +
        `  pg_restore -f backup.sql --no-owner --no-privileges "${file}"`
    );
  }

  await new Promise((resolve) => out.end(resolve));
  return target;
}

function unescape(value: string): string | null {
  if (value === "\\N") return null;
  return value
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * Lee los bloques `COPY public.<tabla> (...) FROM stdin;` del SQL plano, que es
 * donde `pg_dump` pone los datos: `{ tabla: [{ columna: valor }] }`. Todo llega
 * como texto (los tipos los pone quien consume).
 */
export function readDump(file: string): Dump {
  const lines = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const dump: Dump = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("COPY public.")) continue;
    const table = line.slice("COPY public.".length).split(" ")[0];
    const cols = line
      .slice(line.indexOf("(") + 1, line.lastIndexOf(")"))
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""));
    const rows: Row[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== "\\."; j++) {
      const values = lines[j].split("\t").map(unescape);
      rows.push(Object.fromEntries(cols.map((c, k) => [c, values[k] ?? null])));
    }
    dump[table] = rows;
    i = j;
  }
  return dump;
}
