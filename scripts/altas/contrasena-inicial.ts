/**
 * Pone la contraseña inicial 123456 a las cuentas creadas por la sincronización, o a TODAS con --todas.
 * Por defecto NO escribe nada; agrega --apply para aplicar.
 *
 * Uso (desde api/): npx ts-node -r tsconfig-paths/register scripts/altas/contrasena-inicial.ts [--apply]
 */
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

const INITIAL_PASSWORD = "123456";

async function main() {
  const apply = process.argv.includes("--apply");
  const todas = process.argv.includes("--todas");
  const users = todas
    ? await prismaClient.user.findMany({ select: { id: true, username: true } })
    : await prismaClient.user.findMany({
        where: { id: { in: [...new Set((await prismaClient.auditLog.findMany({ where: { action: "USER_SYNC_CREATED" }, select: { entityId: true } })).map((a) => a.entityId))] } },
        select: { id: true, username: true },
      });
  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply)");
  console.log(`cuentas a cambiar: ${users.length}${todas ? " (todas)" : " (creadas por la sincronizacion)"}`);
  if (!apply) return;

  const hash = await hashPassword(INITIAL_PASSWORD);
  await prismaClient.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { password: hash } });
    await tx.auditLog.create({
      data: {
        action: todas ? "USER_PASSWORD_SET_ALL" : "USER_SYNC_INITIAL_PASSWORD_SET",
        entityType: "User",
        entityId: users[0]?.id ?? "none",
        userName: "script contrasena-inicial",
        metadata: { cuentas: users.length, usernames: users.map((u) => u.username) },
      },
    });
  });
  console.log(`contraseña inicial puesta en ${users.length} cuentas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
