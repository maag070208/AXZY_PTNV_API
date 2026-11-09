/**
 * Inserta (idempotente, insert-missing por `code`) los 32 articulos BL-001..BL-032 del catalogo de blancos:
 * kind LINEN, categoria por nombre (se crea si falta), unidad "Pieza" (se crea si falta),
 * idealStock = par, lastCost = costo (0 = sin compra registrada -> null) y size = medida.
 * Datos tomados del formato de inventario de blancos del hotel (sep-2026).
 *
 * Uso:  npm run linen:catalog
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// code, nombre, categoria, medida, par, costo
const ITEMS: Array<[string, string, string, string, number, number]> = [
  // code, nombre, categoría, medida, par, costo
  ['BL-001', 'Toalla de baño Nirvana', 'Baño', '145x180', 2624, 159.00],
  ['BL-002', 'Toalla de mano Supreme', 'Baño', '16x27', 1312, 21.60],
  ['BL-003', 'Tapete de baño Supreme', 'Baño', '20x30', 1312, 50.85],
  ['BL-004', 'Toalla de alberca rayada', 'Alberca', '90x170', 800, 185.00],
  ['BL-005', 'Almohada KS', 'Almohada', 'King', 1237, 120.00],
  ['BL-006', 'Almohada Ultra Confort STD', 'Almohada', 'Estándar', 850, 114.00],
  ['BL-007', 'Cobija fleece camel QS', 'Cama', '228x228', 579, 297.25],
  ['BL-008', 'Cobija fleece camel KS', 'Cama', '280x228', 215, 348.50],
  ['BL-009', 'Colcha KS (Villas y JR\'s)', 'Cama', 'King', 194, 0],
  ['BL-010', 'Colcha KS Ala Norte', 'Cama', 'King', 38, 589.00],
  ['BL-011', 'Colcha KS capitonada Ala Sur', 'Cama', 'King', 27, 503.00],
  ['BL-012', 'Colcha MAT capitonada gabardina QS Ala Norte', 'Cama', 'Queen', 165, 935.20],
  ['BL-013', 'Colcha QS capitonada Ala Sur', 'Cama', 'Queen', 162, 761.60],
  ['BL-014', 'Cubre colchón KS', 'Cama', 'King', 215, 334.00],
  ['BL-015', 'Cubre colchón QS', 'Cama', 'Queen', 273, 234.00],
  ['BL-016', 'Funda almohada sobre lisa QS blanca', 'Cama', '66x51', 1090, 39.98],
  ['BL-017', 'Funda almohada sobre lisa KS blanca', 'Cama', '91x51', 1520, 43.05],
  ['BL-018', 'Funda caracol', 'Cama', 'Estándar', 387, 0],
  ['BL-019', 'Funda de almohada p/sofá cama', 'Sofá cama', 'Estándar', 840, 0],
  ['BL-020', 'Funda KZ guinda', 'Cama', 'King', 645, 59.00],
  ['BL-021', 'Pie de cama guinda', 'Cama', '0.47x2.55', 162, 82.00],
  ['BL-022', 'Protector almohada con cierre QS', 'Almohada', 'Queen', 545, 54.00],
  ['BL-023', 'Protector almohada con zíper KS', 'Almohada', '91x51', 1405, 38.95],
  ['BL-024', 'Rodapié beige KS', 'Cama', 'King', 148, 586.00],
  ['BL-025', 'Rodapié beige QS', 'Cama', 'Queen', 273, 509.00],
  ['BL-026', 'Rodapié KS guinda', 'Cama', 'King', 68, 164.00],
  ['BL-027', 'Sábana 250 H raya 1 cm cajón IND', 'Cama', 'Individual', 0, 220.00],
  ['BL-028', 'Sábana KS', 'Cama', '2.9x2.9', 430, 233.03],
  ['BL-029', 'Sábana percale T180 hilos', 'Cama', '90x110', 545, 0],
  ['BL-030', 'Sábana plana 250 hilos', 'Cama', '240x280', 975, 256.25],
  ['BL-031', 'Sábana plana p/sofá cama', 'Sofá cama', 'Matrimonial', 840, 0],
  ['BL-032', 'Sábana tira p/sofá cama', 'Sofá cama', 'Matrimonial', 1260, 0],
];

/** Vida útil estimada en lavadas ("hoja Vida Util" del formato; 0 = no se lava en ciclo normal). */
const WASH_LIFE: Record<string, number> = {
  'BL-001': 100, 'BL-002': 80, 'BL-003': 100, 'BL-004': 100, 'BL-005': 0, 'BL-006': 0, 'BL-007': 40, 'BL-008': 40,
  'BL-009': 40, 'BL-010': 40, 'BL-011': 40, 'BL-012': 40, 'BL-013': 40, 'BL-014': 60, 'BL-015': 60,
  'BL-016': 120, 'BL-017': 120, 'BL-018': 120, 'BL-019': 120, 'BL-020': 120, 'BL-021': 60, 'BL-022': 60,
  'BL-023': 60, 'BL-024': 60, 'BL-025': 60, 'BL-026': 60, 'BL-027': 150, 'BL-028': 150, 'BL-029': 150,
  'BL-030': 150, 'BL-031': 150, 'BL-032': 150,
};

// code, nombre, presentación, estándar por habitación ocupada (costo 0 = capturar en catálogo)
const AMENITIES: Array<[string, string, string, number]> = [
  ['AM-001', 'Champú', 'Botella 30 ml', 1],
  ['AM-002', 'Acondicionador', 'Botella 30 ml', 1],
  ['AM-003', 'Jabón de tocador', 'Barra 25 g', 2],
  ['AM-004', 'Gel de baño', 'Botella 30 ml', 1],
  ['AM-005', 'Crema corporal', 'Botella 30 ml', 1],
  ['AM-006', 'Kit dental', 'Pieza', 0],
  ['AM-007', 'Gorro de baño', 'Pieza', 1],
  ['AM-008', 'Papel higiénico', 'Rollo', 2],
  ['AM-009', 'Pañuelos desechables', 'Caja', 0.5],
  ['AM-010', 'Agua embotellada', 'Botella 500 ml', 2],
];

// code, nombre, prefijo de etiqueta (alta de piezas desde el catálogo de equipos)
const EQUIPMENT_TYPES: Array<[string, string, string]> = [
  ['EQ-SEC', 'Secadora de pelo', 'SEC'],
  ['EQ-ABA', 'Abanico', 'ABA'],
  ['EQ-PLA', 'Plancha', 'PLA'],
  ['EQ-TAB', 'Burro de planchar', 'TAB'],
  ['EQ-CUN', 'Cuna', 'CUN'],
  ['EQ-CAL', 'Calentador', 'CAL'],
  ['EQ-OTR', 'Otro equipo', 'OTR'],
];

async function main() {
  const unit =
    (await prisma.hotelUnit.findUnique({ where: { name: "Pieza" } })) ??
    (await prisma.hotelUnit.create({ data: { name: "Pieza", whole: true } }));

  const categoryIds = new Map<string, string>();
  const categoryOf = async (name: string) => {
    const cached = categoryIds.get(name);
    if (cached) return cached;
    const category =
      (await prisma.hotelProductCategory.findUnique({ where: { name } })) ??
      (await prisma.hotelProductCategory.create({ data: { name } }));
    categoryIds.set(name, category.id);
    return category.id;
  };
  for (const name of new Set(ITEMS.map((item) => item[2]).concat(['Amenidad', 'Equipos']))) await categoryOf(name);

  const existing = new Set((await prisma.hotelProduct.findMany({ select: { code: true } })).map((p) => p.code));
  let created = 0;
  let updated = 0;
  for (const [code, name, category, size, par, cost] of ITEMS) {
    if (existing.has(code)) {
      // La vida útil es dato de negocio: se rellena mientras el artículo no la tenga.
      const product = await prisma.hotelProduct.findUnique({ where: { code }, select: { id: true, washLife: true } });
      if (product && !product.washLife) {
        await prisma.hotelProduct.update({ where: { id: product.id }, data: { washLife: WASH_LIFE[code] ?? null } });
        updated++;
      }
      continue;
    }
    await prisma.hotelProduct.create({
      data: {
        code,
        name,
        kind: "LINEN",
        categoryId: await categoryOf(category),
        unitId: unit.id,
        idealStock: par,
        lastCost: cost > 0 ? cost : null,
        size,
        washLife: WASH_LIFE[code] ?? null,
      },
    });
    created++;
  }

  const amenityCategoryId = await categoryOf('Amenidad');
  let amenitiesCreated = 0;
  for (const [code, name, size, standard] of AMENITIES) {
    if (existing.has(code)) continue;
    await prisma.hotelProduct.create({
      data: {
        code,
        name,
        kind: "CONSUMABLE",
        categoryId: amenityCategoryId,
        unitId: unit.id,
        size,
        standardPerRoom: standard,
        lastCost: null,
      },
    });
    amenitiesCreated++;
  }

  const equipmentCategoryId = await categoryOf('Equipos');
  let equipmentCreated = 0;
  for (const [code, name, tagPrefix] of EQUIPMENT_TYPES) {
    if (existing.has(code)) continue;
    await prisma.hotelProduct.create({
      data: {
        code,
        name,
        kind: "EQUIPMENT",
        categoryId: equipmentCategoryId,
        unitId: unit.id,
        size: null,
        tagPrefix,
        lastCost: null,
      },
    });
    equipmentCreated++;
  }

  console.log(
    `Linen catalog: ${created} blancos + ${amenitiesCreated} amenidades + ${equipmentCreated} equipos created; ` +
      `${ITEMS.length - created} blancos already existed; ${updated} washLife filled.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
