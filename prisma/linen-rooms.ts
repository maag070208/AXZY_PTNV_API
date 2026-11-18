/**
 * Carga (idempotente, insert-or-update) las habitaciones del cliente desde `prisma/linen-data/hotel-rooms.json`:
 * zona por area (la ligada al almacen ZONE HN/HS/VI/JR; si no, por nombre; si no existe se crea y se liga),
 * tipo por nombre (se crea si falta; los existentes no se tocan) y habitacion por (zona, numero) con su
 * composicion (king/queen/sofa/banos). No toca el estado ni otras columnas.
 *
 * Uso:  npm run linen:rooms            (solo base local)
 *       npm run linen:rooms -- --yes   (permite una base que no es local)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface RoomRow {
  number: string;
  area: string;
  type: string;
  kingBeds: number;
  queenBeds: number;
  sofaBeds: number;
  bathrooms: number;
}

const AREAS: Record<string, { name: string; match: string }> = {
  HN: { name: "Hotel Norte", match: "norte" },
  HS: { name: "Hotel Sur", match: "sur" },
  VI: { name: "Villas", match: "villas" },
  JR: { name: "JR's", match: "jr" },
};

const assertSafeDatabase = () => {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  if (!isLocal && !process.argv.includes("--yes")) {
    throw new Error("linen:rooms only runs against a local database; pass --yes to force it");
  }
};

async function resolveZone(code: string): Promise<{ id: string; created: boolean }> {
  const area = AREAS[code];
  if (!area) throw new Error(`Unknown area: ${code}`);
  const warehouse = await prisma.hotelWarehouse.findUnique({ where: { code } });
  if (warehouse?.zoneId) return { id: warehouse.zoneId, created: false };

  const zones = await prisma.hotelZone.findMany({ where: { active: true }, select: { id: true, name: true } });
  let zone = zones.find((z) => z.name.toLowerCase().includes(area.match));
  let created = false;
  if (!zone) {
    zone = await prisma.hotelZone.create({ data: { name: area.name }, select: { id: true, name: true } });
    created = true;
  }
  if (warehouse && !warehouse.zoneId) {
    await prisma.hotelWarehouse.update({ where: { id: warehouse.id }, data: { zoneId: zone.id } });
  }
  return { id: zone.id, created };
}

async function main() {
  assertSafeDatabase();
  const rows: RoomRow[] = JSON.parse(readFileSync(join(__dirname, "linen-data", "hotel-rooms.json"), "utf8"));

  const zoneByArea = new Map<string, string>();
  let zonesCreated = 0;
  for (const code of new Set(rows.map((r) => r.area))) {
    const zone = await resolveZone(code);
    zoneByArea.set(code, zone.id);
    if (zone.created) zonesCreated++;
  }

  const typeByName = new Map<string, string>();
  let typesCreated = 0;
  for (const row of rows) {
    if (typeByName.has(row.type)) continue;
    let type = await prisma.hotelRoomType.findUnique({ where: { name: row.type } });
    if (!type) {
      type = await prisma.hotelRoomType.create({ data: { name: row.type, beds: row.kingBeds + row.queenBeds + row.sofaBeds } });
      typesCreated++;
    }
    typeByName.set(row.type, type.id);
  }

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const zoneId = zoneByArea.get(row.area)!;
    const data = {
      typeId: typeByName.get(row.type)!,
      kingBeds: row.kingBeds,
      queenBeds: row.queenBeds,
      sofaBeds: row.sofaBeds,
      bathrooms: row.bathrooms,
    };
    const existing = await prisma.hotelRoom.findUnique({ where: { zoneId_number: { zoneId, number: row.number } } });
    if (existing) {
      await prisma.hotelRoom.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.hotelRoom.create({ data: { zoneId, number: row.number, ...data } });
      created++;
    }
  }

  console.log(`Rooms created: ${created}, updated: ${updated}. Types created: ${typesCreated}. Zones created: ${zonesCreated}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
