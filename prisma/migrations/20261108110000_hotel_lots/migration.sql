-- Blancos F1: lotes (FIFO), ciclos de lavado y traspaso con doble firma (en transito / recibido con diferencia).

-- AlterEnum
ALTER TYPE "HotelMovementStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "HotelMovementStatus" ADD VALUE 'RECEIVED_WITH_DIFFERENCE';

-- CreateTable
CREATE TABLE "hotel_lots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initialQuantity" DECIMAL(12,3) NOT NULL,
    "sourceMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_wash_cycles" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "washedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movementId" TEXT,

    CONSTRAINT "hotel_wash_cycles_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "hotel_movements" ADD COLUMN "receivedById" TEXT,
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "receiveNotes" TEXT;

-- AlterTable (lotId nullable hasta el backfill)
ALTER TABLE "hotel_movement_lines" ADD COLUMN "lotId" TEXT,
ADD COLUMN "receivedQuantity" DECIMAL(12,3);

ALTER TABLE "hotel_stock" ADD COLUMN "lotId" TEXT;

-- Backfill: un lote INITIAL por producto con existencias o lineas de movimiento.
-- Su fecha es la del primer movimiento del producto (el mas viejo para el FIFO).
INSERT INTO "hotel_lots" ("id", "code", "productId", "receivedAt", "initialQuantity")
SELECT gen_random_uuid()::text, 'INITIAL', p."id",
       COALESCE((SELECT MIN(m."date") FROM "hotel_movement_lines" l JOIN "hotel_movements" m ON m."id" = l."movementId" WHERE l."productId" = p."id"), CURRENT_TIMESTAMP),
       COALESCE((SELECT SUM(s."quantity") FROM "hotel_stock" s WHERE s."productId" = p."id"), 0)
FROM "hotel_products" p
WHERE EXISTS (SELECT 1 FROM "hotel_stock" s WHERE s."productId" = p."id")
   OR EXISTS (SELECT 1 FROM "hotel_movement_lines" l WHERE l."productId" = p."id");

UPDATE "hotel_stock" s SET "lotId" = (SELECT lt."id" FROM "hotel_lots" lt WHERE lt."productId" = s."productId" AND lt."code" = 'INITIAL');
UPDATE "hotel_movement_lines" l SET "lotId" = (SELECT lt."id" FROM "hotel_lots" lt WHERE lt."productId" = l."productId" AND lt."code" = 'INITIAL');

ALTER TABLE "hotel_stock" ALTER COLUMN "lotId" SET NOT NULL;
ALTER TABLE "hotel_movement_lines" ALTER COLUMN "lotId" SET NOT NULL;

-- Unique de existencias por lote
DROP INDEX "hotel_stock_productId_warehouseId_locationId_key";
CREATE UNIQUE INDEX "hotel_stock_productId_warehouseId_locationId_lotId_key" ON "hotel_stock"("productId", "warehouseId", "locationId", "lotId");

-- Indexes
CREATE UNIQUE INDEX "hotel_lots_productId_code_key" ON "hotel_lots"("productId", "code");
CREATE INDEX "hotel_lots_productId_receivedAt_idx" ON "hotel_lots"("productId", "receivedAt");
CREATE INDEX "hotel_wash_cycles_lotId_idx" ON "hotel_wash_cycles"("lotId");

-- Foreign keys
ALTER TABLE "hotel_lots" ADD CONSTRAINT "hotel_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_lots" ADD CONSTRAINT "hotel_lots_sourceMovementId_fkey" FOREIGN KEY ("sourceMovementId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_wash_cycles" ADD CONSTRAINT "hotel_wash_cycles_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "hotel_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_wash_cycles" ADD CONSTRAINT "hotel_wash_cycles_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_stock" ADD CONSTRAINT "hotel_stock_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "hotel_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movement_lines" ADD CONSTRAINT "hotel_movement_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "hotel_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
