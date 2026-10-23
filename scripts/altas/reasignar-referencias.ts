/**
 * Mueve TODO lo que apunta a una cuenta (origen) a otra cuenta (destino): cartas responsivas
 * (prestamos), movimientos, tickets creados y asignados, comentarios, historial, adjuntos,
 * expedientes, reportes, notificaciones, permisos, horas extra, etc.
 *
 * Las tablas se descubren de la propia base (llaves foraneas hacia users), asi que no se
 * queda nada afuera. Todo corre en UNA transaccion: si una tabla no puede moverse
 * (p. ej. una restriccion unica), se revierte todo y no cambia nada.
 *
 * Al final la cuenta origen se DESACTIVA y se le cambia el username (no se borra), y
 * se verifica que ya no quede ninguna referencia a ella.
 *
 * Por defecto NO escribe nada (dry-run: cuenta lo que se movería). Opciones:
 *   --apply   aplica los cambios
 *   --prueba  aplica dentro de una transaccion y la revierte al final (para probar sin cambiar nada)
 *
 * Uso (desde api/, con DATABASE_URL en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/reasignar-referencias.ts <origen-username> <destino-username> [--prueba|--apply]
 */
import { prismaClient } from "@core/config/database";

type Ref = { table: string; column: string; onDelete: string; count: number };

async function discover(): Promise<Array<{ table: string; column: string; onDelete: string }>> {
  const rows = await prismaClient.$queryRawUnsafe<Array<{ table: string; column: string; onDelete: string }>>(`
    select c.relname as "table", a.attname as "column", con.confdeltype::text as "onDelete"
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.confrelid = 'users'::regclass and con.contype = 'f' and array_length(con.conkey, 1) = 1
    order by 1, 2`);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const trial = args.includes("--prueba");
  const [fromName, toName] = args.filter((a) => !a.startsWith("--"));
  if (!fromName || !toName) {
    console.error("Uso: reasignar-referencias.ts <origen-username> <destino-username> [--prueba|--apply]");
    process.exit(1);
  }

  const from = await prismaClient.user.findUnique({ where: { username: fromName } });
  const to = await prismaClient.user.findUnique({ where: { username: toName } });
  if (!from) throw new Error(`No existe la cuenta origen: ${fromName}`);
  if (!to) throw new Error(`No existe la cuenta destino: ${toName}`);
  if (from.id === to.id) throw new Error("Origen y destino son la misma cuenta");

  const fks = await discover();
  const refs: Ref[] = [];
  for (const fk of fks) {
    const rows = await prismaClient.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*)::bigint as n from "${fk.table}" where "${fk.column}" = $1`, from.id
    );
    const count = Number(rows[0]?.n ?? 0);
    refs.push({ ...fk, count });
  }
  const total = refs.reduce((s, r) => s + r.count, 0);

  console.log(`ORIGEN: ${from.username} (${from.name})  ->  DESTINO: ${to.username} (${to.name})`);
  console.log("Referencias encontradas por tabla:");
  for (const r of refs.filter((r) => r.count > 0)) console.log(`  ${r.table}.${r.column}: ${r.count}`);
  console.log(`Total de referencias a mover: ${total}`);
  console.log(apply ? "MODO APLICAR" : trial ? "MODO PRUEBA (se revierte al final)" : "DRY-RUN (no se escribio nada)");
  if (!apply && !trial) return;

  class Rollback extends Error {}
  try {
    await prismaClient.$transaction(
      async (tx) => {
        for (const r of refs) {
          if (r.count === 0) continue;
          await tx.$executeRawUnsafe(`update "${r.table}" set "${r.column}" = $1 where "${r.column}" = $2`, to.id, from.id);
        }
        // Cuenta origen: se desactiva y se libera el username (no se borra).
        await tx.user.update({ where: { id: from.id }, data: { active: false, username: `${from.username}.migrado` } });
        const left = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
          `select (${fks.map((f) => `(select count(*) from "${f.table}" where "${f.column}" = '${from.id}')`).join(" + ") || "0"})::bigint as n`
        );
        if (Number(left[0]?.n ?? 0) > 0) throw new Error("quedaron referencias a la cuenta origen");
        await tx.auditLog.create({
          data: {
            action: "USER_REFERENCES_MOVED",
            entityType: "User",
            entityId: from.id,
            userName: "script reasignar-referencias",
            previousState: { username: from.username, active: from.active },
            newState: { movedTo: to.id, toUsername: to.username },
            metadata: { total, tablas: refs.filter((r) => r.count > 0).map((r) => ({ tabla: r.table, columna: r.column, filas: r.count })) },
          },
        });
        if (trial) throw new Rollback("prueba completa: se revierte");
      },
      { timeout: 60_000 }
    );
    console.log(apply ? "APLICADO: todas las referencias movidas y la cuenta origen desactivada." : "");
  } catch (e) {
    if (e instanceof Rollback) console.log("PRUEBA OK: " + e.message + " (no quedo ningun cambio)");
    else {
      console.error("NO SE APLICO NADA. Motivo:", (e as Error).message);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
