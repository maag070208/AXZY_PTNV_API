/**
 * Genera data de EJEMPLO del almacén de cocina para desarrollo: un chef demo,
 * categorías y proveedores, artículos con mínimos/máximos y lotes con todos los
 * casos que la pantalla distingue:
 *
 * - lote vigente; lote por caducar (dentro de la ventana de aviso); lote caducado con saldo
 * - artículo bajo mínimo y artículo sobre máximo
 * - vajilla con merma por rotura y un lote caducado mermado por caducidad
 * - una reversión
 *
 * Uso:  npm run mock:kitchen            (genera; idempotente)
 *       npm run mock:kitchen -- --clean (solo borra la data de ejemplo)
 *
 * Seguridad: solo corre contra una base local. Todo lo que crea está marcado
 * (departamento `COCINA DEMO`, usuario `demo.chef`, artículos `MK-*`,
 * categorías y proveedores `DEMO *`) y se borra antes de volver a generar.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@core/utils/security";
import { localDateKey, resolveTimezoneWithConfig } from "@core/utils/timezone";
import { KitchenStockService } from "@modules/kitchen/services/kitchen-stock.service";
import { PurchaseOrderService } from "@modules/kitchen/services/purchase-order.service";

const prisma = new PrismaClient();

const DEPARTMENT = "COCINA DEMO";
const USERNAME = "demo.chef";
const ITEM_PREFIX = "MK-";
const DEMO_PREFIX = "DEMO ";

const addDays = (dayKey: string, days: number) => {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("mock:kitchen only runs against a local database (DATABASE_URL)");
  }
}

async function clean() {
  const items = await prisma.kitchenItem.findMany({ where: { code: { startsWith: ITEM_PREFIX } }, select: { id: true } });
  const itemIds = items.map((i) => i.id);
  const lines = await prisma.kitchenMovementLine.findMany({ where: { itemId: { in: itemIds } }, select: { movementId: true } });
  const movementIds = [...new Set(lines.map((l) => l.movementId))];
  await prisma.kitchenMovementLine.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.kitchenMovement.deleteMany({ where: { id: { in: movementIds } } });
  const poLines = await prisma.purchaseOrderLine.findMany({ where: { itemId: { in: itemIds } }, select: { purchaseOrderId: true } });
  const poIds = [...new Set(poLines.map((l) => l.purchaseOrderId))];
  await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  await prisma.kitchenLot.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.kitchenItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.kitchenCategory.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } });
  const user = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.department.deleteMany({ where: { name: DEPARTMENT } });
  console.log(`Borrado: ${itemIds.length} artículos demo y ${movementIds.length} movimientos.`);
}

type ItemSpec = {
  code: string;
  name: string;
  category: string;
  kind: "CONSUMABLE" | "DURABLE";
  unit: "KG" | "G" | "L" | "ML" | "PIECE" | "PACKAGE";
  storage: "DRY" | "REFRIGERATED" | "FROZEN";
  tracksExpiry: boolean;
  min: number;
  max: number | null;
};

const ITEMS: ItemSpec[] = [
  { code: "MK-RES", name: "Carne de res", category: "DEMO Carnes", kind: "CONSUMABLE", unit: "KG", storage: "REFRIGERATED", tracksExpiry: true, min: 10, max: 40 },
  { code: "MK-POLLO", name: "Pechuga de pollo", category: "DEMO Carnes", kind: "CONSUMABLE", unit: "KG", storage: "REFRIGERATED", tracksExpiry: true, min: 15, max: 50 },
  { code: "MK-LECHE", name: "Leche entera", category: "DEMO Lácteos", kind: "CONSUMABLE", unit: "L", storage: "REFRIGERATED", tracksExpiry: true, min: 20, max: 60 },
  { code: "MK-QUESO", name: "Queso manchego", category: "DEMO Lácteos", kind: "CONSUMABLE", unit: "KG", storage: "REFRIGERATED", tracksExpiry: true, min: 5, max: 20 },
  { code: "MK-ARROZ", name: "Arroz", category: "DEMO Abarrotes", kind: "CONSUMABLE", unit: "KG", storage: "DRY", tracksExpiry: false, min: 20, max: 50 },
  { code: "MK-ACEITE", name: "Aceite vegetal", category: "DEMO Abarrotes", kind: "CONSUMABLE", unit: "L", storage: "DRY", tracksExpiry: false, min: 10, max: 30 },
  { code: "MK-JITOMATE", name: "Jitomate", category: "DEMO Verduras", kind: "CONSUMABLE", unit: "KG", storage: "REFRIGERATED", tracksExpiry: true, min: 8, max: 25 },
  { code: "MK-CEBOLLA", name: "Cebolla", category: "DEMO Verduras", kind: "CONSUMABLE", unit: "KG", storage: "REFRIGERATED", tracksExpiry: true, min: 8, max: 25 },
  { code: "MK-CUCHARON", name: "Cucharón", category: "DEMO Utensilios", kind: "DURABLE", unit: "PIECE", storage: "DRY", tracksExpiry: false, min: 6, max: 12 },
  { code: "MK-PLATO", name: "Plato base", category: "DEMO Vajilla", kind: "DURABLE", unit: "PIECE", storage: "DRY", tracksExpiry: false, min: 50, max: 120 },
  { code: "MK-SERVILLETA", name: "Servilleta", category: "DEMO Desechables", kind: "CONSUMABLE", unit: "PACKAGE", storage: "DRY", tracksExpiry: false, min: 10, max: 40 },
];

async function main() {
  assertLocalDatabase();
  await clean();
  if (process.argv.includes("--clean")) return;

  const sysConfig = async (key: string) => (await prisma.sysConfig.findUnique({ where: { key } }))?.value ?? null;
  const tz = await resolveTimezoneWithConfig(undefined, sysConfig);
  const today = localDateKey(new Date(), tz);

  const department = await prisma.department.create({ data: { name: DEPARTMENT } });
  await prisma.user.create({
    data: {
      username: USERNAME,
      password: await hashPassword(randomUUID()),
      name: "Chef Demo",
      role: "CHEF",
      jobTitle: "Chef ejecutivo",
      departmentId: department.id,
    },
  });

  const categoryNames = [...new Set(ITEMS.map((i) => i.category))];
  const categories = new Map<string, string>();
  for (const name of categoryNames) {
    const c = await prisma.kitchenCategory.create({ data: { name } });
    categories.set(name, c.id);
  }
  const supplier = await prisma.supplier.create({ data: { name: "DEMO Proveedor Central", contact: "Ventas", phone: "664-000-0000" } });

  const items = new Map<string, ItemSpec>();
  const unitRows = await prisma.kitchenUnit.findMany();
  const unitIdByCode = new Map(unitRows.map((u) => [u.code, u.id]));
  for (const spec of ITEMS) {
    const unitId = unitIdByCode.get(spec.unit);
    if (!unitId) throw new Error(`Falta la unidad de medida ${spec.unit} (migración kitchen_units_catalog)`);
    await prisma.kitchenItem.create({
      data: {
        code: spec.code,
        name: spec.name,
        categoryId: categories.get(spec.category)!,
        kind: spec.kind,
        unitId,
        storage: spec.storage,
        tracksExpiry: spec.tracksExpiry,
        minStock: spec.min,
        maxStock: spec.max,
      },
    });
    items.set(spec.code, spec);
  }
  const idOf = async (code: string) => (await prisma.kitchenItem.findUniqueOrThrow({ where: { code } })).id;

  const stock = new KitchenStockService(prisma, sysConfig);
  const actor = (await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } })).id;

  // Resolvemos los itemId antes de llamar (el DTO exige uuid).
  const doStockIn = async (lines: Array<{ code: string; quantity: number; lotCode?: string; expiresAt?: string | null }>) => {
    const resolved = await Promise.all(
      lines.map(async (l) => ({
        itemId: await idOf(l.code),
        quantity: l.quantity,
        ...(l.lotCode ? { lotCode: l.lotCode } : {}),
        expiresAt: l.expiresAt ?? null,
      }))
    );
    return stock.stockIn({ supplierId: supplier.id, reference: "REM-DEMO", lines: resolved }, actor);
  };

  // Lote vigente, por caducar y caducado (con saldo para que salga en alertas).
  await doStockIn([
    { code: "MK-RES", quantity: 30, lotCode: "MK-RES-VIG", expiresAt: addDays(today, 20) },
    { code: "MK-POLLO", quantity: 6, lotCode: "MK-POLLO-BAJO", expiresAt: addDays(today, 15) }, // bajo mínimo (15)
    { code: "MK-LECHE", quantity: 40, lotCode: "MK-LECHE-PORCAD", expiresAt: addDays(today, 2) }, // por caducar
    { code: "MK-QUESO", quantity: 10, lotCode: "MK-QUESO-CAD", expiresAt: addDays(today, -5) }, // caducado con saldo
    { code: "MK-ARROZ", quantity: 70, lotCode: "MK-ARROZ-OVER" }, // sobre máximo (50)
    { code: "MK-ACEITE", quantity: 18, lotCode: "MK-ACEITE-A" },
    { code: "MK-JITOMATE", quantity: 20, lotCode: "MK-JITO-A", expiresAt: addDays(today, 6) },
    { code: "MK-CEBOLLA", quantity: 20, lotCode: "MK-CEBO-A", expiresAt: addDays(today, 10) },
    { code: "MK-CUCHARON", quantity: 10 },
    { code: "MK-PLATO", quantity: 90 },
    { code: "MK-SERVILLETA", quantity: 30 },
  ]);

  const stockOut = async (type: "CONSUMPTION" | "WASTE", code: string, quantity: number, wasteReason?: "BREAKAGE" | "EXPIRED") =>
    stock.stockOut(
      {
        type,
        ...(wasteReason ? { wasteReason } : {}),
        notes: "Consumo demo",
        lines: [{ itemId: await idOf(code), quantity }],
      },
      actor
    );

  // Consumos FEFO y una merma por rotura de vajilla.
  await stockOut("CONSUMPTION", "MK-RES", 12);
  await stockOut("CONSUMPTION", "MK-ARROZ", 10);
  await stockOut("CONSUMPTION", "MK-JITOMATE", 8);
  await stockOut("WASTE", "MK-PLATO", 3, "BREAKAGE");

  // Una reversión: deshace un consumo.
  const toReverse = await stockOut("CONSUMPTION", "MK-ACEITE", 2);
  await stock.reverse(toReverse.id, "Reversión demo", actor);

  // Orden de compra demo: creada por el chef, aprobada/enviada y con una
  // recepción parcial (queda en tránsito lo pendiente).
  const purchaseOrders = new PurchaseOrderService(prisma, stock, sysConfig);
  const order = await purchaseOrders.create(
    {
      supplierId: supplier.id,
      expectedAt: addDays(today, 3),
      notes: "OC demo (recepción parcial)",
      lines: [
        { itemId: await idOf("MK-RES"), quantity: 20, unitCost: 180 },
        { itemId: await idOf("MK-POLLO"), quantity: 30, unitCost: 95 },
      ],
    },
    actor
  );
  await purchaseOrders.approve(order.id, actor);
  await purchaseOrders.send(order.id, actor);
  const resLine = order.lines.find((l) => l.item.code === "MK-RES");
  if (resLine) {
    await purchaseOrders.receive(
      order.id,
      { lines: [{ lineId: resLine.id, quantity: 8, lotCode: "MK-RES-OC", expiresAt: addDays(today, 12), unitCost: 180 }] },
      actor
    );
  }

  console.log(
    "Datos de cocina generados: 11 artículos, lotes vigentes/por caducar/caducados, bajo y sobre mínimo, mermas, una reversión y una orden de compra con recepción parcial."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
