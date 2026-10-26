-- M3: warehouses, locations, stock and movements (ledger).
-- Hand-written (not `prisma migrate dev`).

-- CreateEnum
CREATE TYPE "HotelWarehouseKind" AS ENUM ('ADMIN', 'CENTRAL', 'ZONE', 'CART', 'LAUNDRY');
CREATE TYPE "HotelMovementStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'CANCELLED');
CREATE TYPE "HotelMovementType" AS ENUM ('INITIAL_LOAD', 'INBOUND', 'TRANSFER', 'ROOM_CONSUMPTION', 'LINEN_EXCHANGE', 'ADJUST_IN', 'ADJUST_OUT', 'WRITE_OFF');

-- CreateTable
CREATE TABLE "hotel_warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HotelWarehouseKind" NOT NULL DEFAULT 'ZONE',
    "zoneId" TEXT,
    "ownerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_warehouses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_locations" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_stock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_stock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_movements" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "type" "HotelMovementType" NOT NULL,
    "status" "HotelMovementStatus" NOT NULL DEFAULT 'ACTIVE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromWarehouseId" TEXT,
    "warehouseId" TEXT,
    "roomId" TEXT,
    "reasonId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_movement_lines" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2),
    "fromLocationId" TEXT,
    "toLocationId" TEXT,

    CONSTRAINT "hotel_movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_warehouses_code_key" ON "hotel_warehouses"("code");
CREATE UNIQUE INDEX "hotel_locations_warehouseId_code_key" ON "hotel_locations"("warehouseId", "code");
CREATE UNIQUE INDEX "hotel_stock_productId_warehouseId_locationId_key" ON "hotel_stock"("productId", "warehouseId", "locationId");
CREATE UNIQUE INDEX "hotel_movements_folio_key" ON "hotel_movements"("folio");
CREATE UNIQUE INDEX "hotel_movements_requestId_key" ON "hotel_movements"("requestId");
CREATE INDEX "hotel_movements_type_date_idx" ON "hotel_movements"("type", "date");
CREATE INDEX "hotel_movements_roomId_date_idx" ON "hotel_movements"("roomId", "date");

-- Database constraints (M3 plan): stock is never negative; a single initial load
-- per warehouse; a single active cart per housekeeper; a single active laundry activa.
ALTER TABLE "hotel_stock" ADD CONSTRAINT "hotel_stock_quantity_nonnegative" CHECK ("quantity" >= 0);
CREATE UNIQUE INDEX "hotel_movements_carga_inicial_unica" ON "hotel_movements"("warehouseId")
    WHERE "type" = 'INITIAL_LOAD' AND "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "hotel_warehouses_carro_activo_unico" ON "hotel_warehouses"("ownerId")
    WHERE "kind" = 'CART' AND "active";
CREATE UNIQUE INDEX "hotel_warehouses_lavanderia_activa_unica" ON "hotel_warehouses"("kind")
    WHERE "kind" = 'LAUNDRY' AND "active";

-- AddForeignKey
ALTER TABLE "hotel_warehouses" ADD CONSTRAINT "hotel_warehouses_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "hotel_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_warehouses" ADD CONSTRAINT "hotel_warehouses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_locations" ADD CONSTRAINT "hotel_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_stock" ADD CONSTRAINT "hotel_stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stock" ADD CONSTRAINT "hotel_stock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_stock" ADD CONSTRAINT "hotel_stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "hotel_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "hotel_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_movement_lines" ADD CONSTRAINT "hotel_movement_lines_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "hotel_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_movement_lines" ADD CONSTRAINT "hotel_movement_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movement_lines" ADD CONSTRAINT "hotel_movement_lines_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "hotel_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_movement_lines" ADD CONSTRAINT "hotel_movement_lines_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "hotel_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
