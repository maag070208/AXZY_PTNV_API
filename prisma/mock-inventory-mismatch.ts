/**
 * Inventa DESCUADRES de inventario en local para poder ver y probar el flujo que
 * los resuelve: renglones de movimiento cuya `quantity` no coincide con las
 * unidades que tienen ligadas (la regla `MOVEMENT_UNITS_MISMATCH` del auditor,
 * la que reporta «Movimientos cuya cantidad no coincide con sus unidades»). El
 * caso real del cliente son altas viejas del respaldo que quedaron sin ligar.
 *
 * Uso:  npm run mock:inventory-mismatch            (los crea; idempotente)
 *       npm run mock:inventory-mismatch -- --clean (solo borra)
 *
 * Arma a propósito los DOS casos que el flujo tiene que distinguir:
 *
 *   A) «MOCK DESCUADRE A — se arregla ligando»: el dispositivo tiene 3 piezas y
 *      el alta declara 3 con UNA sola ligada. El kardex cuadra (3 = 3): solo
 *      faltan por ligar 2 piezas que sí existen.
 *   B) «MOCK DESCUADRE B — hay que cuadrar la cantidad»: el dispositivo tiene 2
 *      piezas, el alta declara 4 SIN ligar y una salida de ajuste de 2 (con sus
 *      2 piezas ligadas) deja el kardex cuadrado (4 − 2 = 2). No hay piezas
 *      suficientes para ligar: el renglón declara más de lo que existe.
 *
 * Seguridad: solo corre contra base local, todo va marcado con `MOCK-DESCUADRE`
 * y se borra antes de volver a generar (por eso es idempotente).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Marca de todo lo que crea: dispositivos, movimientos y activos fijos. */
const PREFIJO = "MOCK-DESCUADRE";
const TAG = "MOCK-DESCUADRE";
const TIPO_CODE = "MOCK-DESCUADRE";

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("mock:inventory-mismatch solo corre contra una base local (DATABASE_URL)");
  }
}

async function clean() {
  const deMentira = { reason: { startsWith: PREFIJO } };
  await prisma.movementItemUnit.deleteMany({ where: { item: { movement: deMentira } } });
  await prisma.movementItem.deleteMany({ where: { movement: deMentira } });
  await prisma.movement.deleteMany({ where: deMentira });
  await prisma.deviceUnit.deleteMany({ where: { assetTag: { startsWith: TAG } } });
  await prisma.device.deleteMany({ where: { name: { startsWith: PREFIJO } } });
  await prisma.deviceType.deleteMany({ where: { code: TIPO_CODE } });
}

async function main() {
  assertLocalDatabase();
  await clean();
  if (process.argv.includes("--clean")) {
    console.log(`[mock:inventory-mismatch] descuadres de mentira borrados`);
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) throw new Error("no hay un ADMIN activo para firmar los movimientos");

  const tipo = await prisma.deviceType.create({
    data: {
      code: TIPO_CODE,
      name: "MOCK DESCUADRE",
      assetTagPrefix: "MOCK-DESC",
      useSerialNumber: false,
    },
  });

  /** Dispositivo de mentira con sus piezas físicas (todas disponibles). */
  const dispositivo = async (sufijo: string, piezas: number) => {
    const device = await prisma.device.create({
      data: {
        typeId: tipo.id,
        name: `${PREFIJO} ${sufijo}`,
        brand: "MOCK",
        model: sufijo,
      },
    });
    const units = [];
    for (let i = 1; i <= piezas; i++) {
      units.push(
        await prisma.deviceUnit.create({
          data: { deviceId: device.id, assetTag: `${TAG}-${sufijo}-${i}`, area: "SISTEMAS" },
        })
      );
    }
    return { device, units };
  };

  const movimiento = (deviceId: string, type: "STOCK_IN" | "ADJUSTMENT_OUT", quantity: number, reason: string) =>
    prisma.movement.create({
      data: {
        type,
        createdById: admin.id,
        reason: `${PREFIJO} ${reason}`,
        items: { create: { deviceId, quantity } },
      },
      include: { items: true },
    });

  // A) tiene con qué arreglarse: 3 piezas, alta de 3 con una ligada.
  const a = await dispositivo("A-ligar", 3);
  const altaA = await movimiento(a.device.id, "STOCK_IN", 3, "A: alta de 3 con una pieza ligada");
  await prisma.movementItemUnit.create({
    data: { movementItemId: altaA.items[0].id, deviceUnitId: a.units[0].id },
  });

  // B) no tiene con qué: 2 piezas, alta de 4 sin ligar y salida de ajuste de 2
  //    (con sus dos piezas ligadas) que deja el kardex cuadrado.
  const b = await dispositivo("B-cuadrar", 2);
  await movimiento(b.device.id, "STOCK_IN", 4, "B: alta de 4 sin piezas ligadas");
  const salidaB = await movimiento(b.device.id, "ADJUSTMENT_OUT", 2, "B: salida de ajuste que cuadra el kardex");
  for (const unit of b.units) {
    await prisma.movementItemUnit.create({
      data: { movementItemId: salidaB.items[0].id, deviceUnitId: unit.id },
    });
  }

  console.log(
    [
      `[mock:inventory-mismatch] descuadres creados:`,
      `  · ${PREFIJO} A-ligar  → alta de 3 con 1 pieza ligada (faltan 2, SÍ existen)`,
      `  · ${PREFIJO} B-cuadrar → alta de 4 con 0 piezas ligadas (solo hay 2)`,
      `Se ven en el panel de Auditoría de inventario (/inventory) y en GET /inventory/audit.`,
      `Para borrarlos: npm run mock:inventory-mismatch -- --clean`,
    ].join("\n")
  );
}

main()
  .catch((err) => {
    console.error("[mock:inventory-mismatch] error:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
