-- Blancos F5: control semanal de amenidades por área.

-- CreateEnum
CREATE TYPE "HotelAmenityControlStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "hotel_amenity_weekly_controls" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "weekFrom" DATE NOT NULL,
    "weekTo" DATE NOT NULL,
    "occupiedNights" INTEGER NOT NULL DEFAULT 0,
    "occupiedNightsOverride" INTEGER,
    "status" "HotelAmenityControlStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "flaggedLines" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_amenity_weekly_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_amenity_weekly_lines" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "standardPerRoom" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "initialStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "supplied" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "extras" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "finalStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "realConsumption" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "expectedConsumption" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "diffPct" DECIMAL(9,2),

    CONSTRAINT "hotel_amenity_weekly_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_amenity_weekly_controls_folio_key" ON "hotel_amenity_weekly_controls"("folio");
CREATE UNIQUE INDEX "hotel_amenity_weekly_controls_warehouseId_weekFrom_key" ON "hotel_amenity_weekly_controls"("warehouseId", "weekFrom");
CREATE INDEX "hotel_amenity_weekly_controls_status_weekFrom_idx" ON "hotel_amenity_weekly_controls"("status", "weekFrom");
CREATE UNIQUE INDEX "hotel_amenity_weekly_lines_controlId_productId_key" ON "hotel_amenity_weekly_lines"("controlId", "productId");

-- AddForeignKey
ALTER TABLE "hotel_amenity_weekly_controls" ADD CONSTRAINT "hotel_amenity_weekly_controls_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_amenity_weekly_lines" ADD CONSTRAINT "hotel_amenity_weekly_lines_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "hotel_amenity_weekly_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_amenity_weekly_lines" ADD CONSTRAINT "hotel_amenity_weekly_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
