/*
  Warnings:

  - You are about to drop the column `ubicacionId` on the `cartas_responsivas` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `devices` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `inventory_movements` table. All the data in the column will be lost.
  - You are about to drop the `locations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sublugares` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT "cartas_responsivas_ubicacionId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_locationId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_locationId_fkey";

-- DropForeignKey
ALTER TABLE "locations" DROP CONSTRAINT "locations_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "sublugares" DROP CONSTRAINT "sublugares_locationId_fkey";

-- DropIndex
DROP INDEX "cartas_responsivas_ubicacionId_idx";

-- DropIndex
DROP INDEX "devices_locationId_idx";

-- DropIndex
DROP INDEX "inventory_movements_locationId_idx";

-- Add new columns first (so backfill can point at departments)
ALTER TABLE "cartas_responsivas" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "devices" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "inventory_movements" ADD COLUMN "departmentId" TEXT;

-- Backfill: propagate the department the location belonged to
UPDATE devices SET "departmentId" = l."departmentId"
FROM locations l WHERE devices."locationId" = l.id;

UPDATE cartas_responsivas SET "departmentId" = l."departmentId"
FROM locations l WHERE cartas_responsivas."ubicacionId" = l.id;

UPDATE inventory_movements SET "departmentId" = l."departmentId"
FROM locations l WHERE inventory_movements."locationId" = l.id;

-- Drop legacy columns
ALTER TABLE "cartas_responsivas" DROP COLUMN "ubicacionId";

ALTER TABLE "devices" DROP COLUMN "locationId";

ALTER TABLE "inventory_movements" DROP COLUMN "locationId";

-- DropTable
DROP TABLE "locations";

-- DropTable
DROP TABLE "sublugares";

-- CreateIndex
CREATE INDEX "cartas_responsivas_departmentId_idx" ON "cartas_responsivas"("departmentId");

-- CreateIndex
CREATE INDEX "devices_departmentId_idx" ON "devices"("departmentId");

-- CreateIndex
CREATE INDEX "inventory_movements_departmentId_idx" ON "inventory_movements"("departmentId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "devices_carta_activa_uniq" RENAME TO "devices_cartaActivaId_key";
