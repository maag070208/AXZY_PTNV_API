/**
 * Actualiza los fixtures de `prisma/seed-data/` con un respaldo PRODUCTIVO que
 * ya está en el MODELO ACTUAL (el que dejó la migración
 * `20260917195258_inventario_model`: `device_types` / `devices` / `device_units`
 * / `movements` / `loans`…).
 *
 * Uso:  npm run seed:from-backup -- <ruta/al/respaldo.dump|backup.sql>
 *       (por omisión `prisma/legacy/backup.sql`)
 *
 * Acepta el respaldo tal como lo entrega el cliente:
 *  - `pg_dump -Fc` (formato *custom*, empieza con la firma `PGDMP`): se convierte
 *    a SQL plano con `pg_restore` (local o dentro del contenedor de Postgres).
 *  - SQL plano (bloques `COPY ... FROM stdin`): se lee directo.
 *
 * Diferencias con `extract.ts` (el del modelo VIEJO, que sigue existiendo para
 * respaldos históricos):
 *  - No convierte nada: el respaldo ya trae el modelo nuevo, así que sólo
 *    traduce el texto del `COPY` a JSON con los tipos del esquema.
 *  - Las columnas y sus tipos salen del ESQUEMA DE PRISMA (DMMF), no de listas
 *    escritas a mano: si mañana se agrega una columna, entra sola al fixture.
 *  - Conserva lo que los fixtures anteriores perdían (expediente de personal,
 *    `requestId`/`reversalOfId` de movimientos, evidencias de tareas).
 *
 * NO toca `permissions.json`, `role_permissions.json` ni `roles.json`: esos son
 * el catálogo del repo (insert-missing al arrancar) y el respaldo del cliente
 * puede venir de un esquema anterior. Regenerarlos rompería el control de acceso.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { readDump, toPlainSql } from "./dump";

const SRC = path.resolve(process.argv[2] ?? path.join(__dirname, "backup.sql"));
const OUT = path.join(__dirname, "..", "seed-data");

/**
 * Tablas que el seed carga desde fixtures (`prisma/seed.ts`), en el orden en que
 * las inserta. Cualquier otra tabla del respaldo se ignora a propósito: o la
 * siembra el código (`seedHrCatalogs`, `seedSchedules`, permisos, roles) o no
 * forma parte del respaldo que se restaura (`_prisma_migrations`, bitácoras de
 * correo, checador…).
 */
const TABLES = [
  "departments",
  "subareas",
  "users",
  "notifications",
  "tickets",
  "ticket_assignments",
  "ticket_assignment_comments",
  "ticket_attachments",
  "ticket_comments",
  "ticket_history",
  "legacy_sequences",
  "device_types",
  "devices",
  "device_units",
  "movements",
  "movement_items",
  "movement_item_units",
  "loans",
  "loan_items",
  "loan_item_units",
  "material_outputs",
  "audit_logs",
] as const;

// ---------------------------------------------------------------------------
// Esquema: columnas y tipos reales de cada tabla, tomados del DMMF de Prisma.
// ---------------------------------------------------------------------------
const MODEL_BY_TABLE = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.dbName ?? model.name, model])
);

/** `{a,b,"c d"}` (literal de arreglo de Postgres) → `["a","b","c d"]`. */
function parsePgArray(raw: string): string[] {
  const body = raw.replace(/^\{/, "").replace(/\}$/, "");
  if (body === "") return [];
  return body.match(/"(?:[^"\\]|\\.)*"|[^,]+/g)?.map((v) => v.replace(/^"|"$/g, "").replace(/\\"/g, '"')) ?? [];
}

/**
 * Convierte el texto del `COPY` al tipo del campo. `null` se conserva como
 * `null` (el literal `\N` de Postgres) para no inventar valores.
 */
function coerce(field: { type: string; isList: boolean }, raw: string | null): unknown {
  if (raw === null) return null;
  if (field.isList) return parsePgArray(raw);
  switch (field.type) {
    case "Boolean":
      return raw === "t" || raw === "true";
    case "Int":
    case "BigInt":
    case "Float":
    case "Decimal":
      return Number(raw);
    case "Json":
      return raw === "" ? null : JSON.parse(raw);
    // Las fechas del COPY ya vienen en el formato que `reviveDates` del seed
    // reconoce ("2026-09-13 20:28:07.26"); se dejan tal cual.
    case "DateTime":
    case "String":
    default:
      return raw;
  }
}

/**
 * Columnas que apuntan a un catálogo que el seed siembra POR NOMBRE (y por lo
 * tanto con ids distintos en cada base): en el fixture viaja el NOMBRE y el seed
 * lo resuelve contra el catálogo de esa base. Si viajara el id del respaldo, la
 * llave foránea apuntaría a una fila inexistente y la carga fallaría.
 *
 * El resto de las llaves foráneas (departamentos, usuarios, dispositivos,
 * unidades, movimientos…) sí conserva su id, porque esas filas vienen en el
 * mismo respaldo.
 */
const NAME_LOOKUPS: Record<string, { field: string; as: string; table: string }[]> = {
  users: [
    { field: "genderId", as: "genderName", table: "genders" },
    { field: "bloodTypeId", as: "bloodTypeName", table: "blood_types" },
  ],
  tickets: [{ field: "categoryId", as: "categoryName", table: "ticket_categories" }],
};

// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(SRC)) throw new Error(`No existe el respaldo: ${SRC}`);

  return (async () => {
    console.log(`Respaldo: ${SRC}`);
    const sqlFile = await toPlainSql(SRC);
    if (sqlFile !== SRC) console.log("  (dump custom convertido a SQL plano)");

    const dump = readDump(sqlFile);

    // Nombre de cada fila de los catálogos que se resuelven por nombre.
    const nameOf = new Map<string, Map<string, string>>();
    for (const lookup of Object.values(NAME_LOOKUPS).flat()) {
      if (nameOf.has(lookup.table)) continue;
      nameOf.set(
        lookup.table,
        new Map((dump[lookup.table] ?? []).map((row) => [row.id ?? "", row.name ?? ""]))
      );
    }

    console.log("\nFixtures actualizados:");
    const summary: string[] = [];

    for (const table of TABLES) {
      const model = MODEL_BY_TABLE.get(table);
      if (!model) throw new Error(`El esquema no tiene la tabla "${table}"`);
      const rows = dump[table];
      const lookups = NAME_LOOKUPS[table] ?? [];

      if (rows === undefined) {
        console.log(`  ${String(0).padStart(4)}  ${table}.json  (la tabla no viene en el respaldo)`);
        continue;
      }

      // Sólo los campos con valor propio —escalares Y enums (`status`, `type`,
      // `condition`…): en el DMMF los enums NO son `kind: "scalar"`— presentes en
      // el respaldo: lo que la base del cliente no tiene (una columna de una
      // migración posterior) se omite y el esquema aplica su valor por omisión.
      const fields = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
      const available = new Set(Object.keys(rows[0] ?? {}));
      const looked = new Set(lookups.map((l) => l.field));
      const used = fields.filter((f) => available.has(f.name) && !looked.has(f.name));

      const out = rows.map((row) => {
        const record: Record<string, unknown> = {};
        for (const field of used) {
          record[field.name] = coerce(field, row[field.name] ?? null);
        }
        for (const lookup of lookups) {
          record[lookup.as] = nameOf.get(lookup.table)?.get(row[lookup.field] ?? "") ?? null;
        }
        return record;
      });

      const previous = previousCount(table);
      fs.writeFileSync(path.join(OUT, `${table}.json`), `${JSON.stringify(out, null, 2)}\n`);

      const delta = previous === null || previous === out.length ? "" : `  (antes ${previous})`;
      console.log(`  ${String(out.length).padStart(4)}  ${table}.json${delta}`);
      if (out.length === 0) {
        console.log(`        el respaldo no trae filas de esta tabla`);
      } else {
        const dropped = fields.filter((f) => !available.has(f.name)).map((f) => f.name);
        if (dropped.length > 0) {
          console.log(
            `        sin datos en el respaldo (el esquema aplica sus valores por omisión): ${dropped.join(", ")}`
          );
        }
      }
      summary.push(`${out.length} ${table}`);
    }

    // Huella del respaldo ORIGINAL (no del SQL convertido: `pg_restore` mete un
    // token aleatorio en cada conversión). Deja rastro de con qué respaldo se
    // generaron los fixtures sin versionar el .dump, que está en .gitignore.
    const digest = crypto.createHash("sha256").update(fs.readFileSync(SRC)).digest("hex");
    fs.writeFileSync(
      path.join(OUT, "SOURCE.json"),
      `${JSON.stringify(
        {
          source: path.basename(SRC),
          sha256: digest,
          generatedAt: new Date().toISOString(),
          rows: Object.fromEntries(
            TABLES.map((t) => [t, dump[t]?.length ?? 0]).filter(([, n]) => (n as number) > 0)
          ),
        },
        null,
        2
      )}\n`
    );

    console.log(`\nListo. Huella del respaldo: ${digest.slice(0, 16)}…`);
    console.log(`Siguiente paso: npm run cutover   (aplica migraciones y recarga la base)`);
  })();
}

/** Cuántas filas tenía el fixture antes, para mostrar el cambio. */
function previousCount(table: string): number | null {
  try {
    const file = path.join(OUT, `${table}.json`);
    const previous = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown[];
    return previous.length;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
