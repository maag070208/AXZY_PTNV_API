/**
 * Crea (idempotente, solo agrega lo que falta) los almacenes de Blancos con sus ubicaciones:
 * ALM (CENTRAL), NEW (NEW_LINEN), LAV (LAUNDRY, si no hay una activa), roperias HN/HS/VI/JR (ZONE,
 * ligadas a su zona por nombre si existe), puntos REC/AP/AT (POINT), SPA, EQP (EQUIPMENT) y AME (CENTRAL).
 *
 * Uso:  npm run linen:setup            (solo base local)
 *       npm run linen:setup -- --yes   (permite una base que no es local)
 */
import "dotenv/config";
import { PrismaClient, type HotelWarehouseKind } from "@prisma/client";
import { DEFAULT_LOCATIONS } from "@modules/hotel-store/services/warehouse.service";

const prisma = new PrismaClient();

interface AreaSpec {
  code: string;
  name: string;
  kind: HotelWarehouseKind;
  /** Texto a buscar (sin distinguir mayusculas) en el nombre de las zonas activas. */
  zoneMatch?: string;
}

const AREAS: AreaSpec[] = [
  { code: "ALM", name: "Almacén general", kind: "CENTRAL" },
  { code: "NEW", name: "Bodega de nuevos", kind: "NEW_LINEN" },
  { code: "LAV", name: "Lavandería", kind: "LAUNDRY" },
  { code: "HN", name: "Ropería Hotel Norte", kind: "ZONE", zoneMatch: "norte" },
  { code: "HS", name: "Ropería Hotel Sur", kind: "ZONE", zoneMatch: "sur" },
  { code: "VI", name: "Ropería Villas", kind: "ZONE", zoneMatch: "villas" },
  { code: "JR", name: "Ropería JR's", kind: "ZONE", zoneMatch: "jr" },
  { code: "REC", name: "Recepción", kind: "POINT" },
  { code: "AP", name: "Alberca pública", kind: "POINT" },
  { code: "AT", name: "Alberca techada", kind: "POINT" },
  { code: "SPA", name: "Spa", kind: "SPA" },
  { code: "EQP", name: "Bodega de equipos", kind: "EQUIPMENT" },
  { code: "AME", name: "Bodega de amenidades", kind: "CENTRAL" },
];

const assertSafeDatabase = () => {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  if (!isLocal && !process.argv.includes("--yes")) {
    throw new Error("linen:setup only runs against a local database; pass --yes to force it");
  }
};

async function main() {
  assertSafeDatabase();
  const zones = await prisma.hotelZone.findMany({ where: { active: true }, select: { id: true, name: true } });
  const created: string[] = [];
  const completed: string[] = [];

  for (const area of AREAS) {
    if (area.kind === "LAUNDRY") {
      // Una sola lavanderia activa: si ya existe otra, se respeta.
      const existing = await prisma.hotelWarehouse.findFirst({ where: { kind: "LAUNDRY", active: true } });
      if (existing && existing.code !== area.code) {
        console.log(`Laundry already exists (${existing.code}); skipping ${area.code}`);
        continue;
      }
    }

    let warehouse = await prisma.hotelWarehouse.findUnique({ where: { code: area.code } });
    if (!warehouse) {
      const needle = area.zoneMatch?.toLowerCase();
      const zone = needle ? zones.find((z) => z.name.toLowerCase().includes(needle)) : undefined;
      warehouse = await prisma.hotelWarehouse.create({
        data: { code: area.code, name: area.name, kind: area.kind, zoneId: zone?.id ?? null },
      });
      created.push(area.code);
    }

    // Agrega las ubicaciones por defecto que falten (sin tocar las existentes).
    const have = new Set(
      (await prisma.hotelLocation.findMany({ where: { warehouseId: warehouse.id }, select: { code: true } })).map((l) => l.code)
    );
    const hasDefault = (await prisma.hotelLocation.count({ where: { warehouseId: warehouse.id, isDefault: true } })) > 0;
    const missing = DEFAULT_LOCATIONS[warehouse.kind].filter((code) => !have.has(code));
    if (missing.length > 0) {
      await prisma.hotelLocation.createMany({
        data: missing.map((code, index) => ({
          warehouseId: warehouse!.id,
          code,
          isDefault: !hasDefault && index === 0,
        })),
      });
      if (!created.includes(area.code)) completed.push(area.code);
    }
  }

  console.log(`Created: ${created.join(", ") || "none"}. Locations completed: ${completed.join(", ") || "none"}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
